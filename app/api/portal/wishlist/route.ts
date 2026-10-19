import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requirePortalUser } from "@/lib/portalAuth";
import { listPoolProperties, normalizeDomain } from "@/lib/hubspotPool";
import { icpHash } from "@/lib/wishlistFit";
import {
  cardLemlistFields,
  getClientIcpText,
  markRecommendation,
  poolCompanyLemlistFields,
  poolCompanyToCard,
  type CompanyCard,
  type LemlistCompanyFields,
} from "@/lib/wishlist";
import { decodeRef } from "@/lib/unifiedSearch";
import { pushWishlistItemToLemlist } from "@/lib/wishlistLemlist";

export const dynamic = "force-dynamic";

// GET — wishlist del cliente de la sesión (sin la fuente: el cliente no la ve)
export async function GET() {
  const { user, response } = await requirePortalUser();
  if (!user) return response;
  const { data, error } = await supabaseAdmin()
    .from("client_wishlist")
    .select("id, company_name, domain, linkedin_url, mode, fit_score, fit_reason, status, requested_by_email, created_at")
    .eq("client_id", user.clientId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// POST — agrega una empresa a la wishlist:
//   { ref, mode, card? }  empresa de los resultados (ref opaca de la búsqueda)
//   { manual: { name, website?, linkedin_url?, comment? } }  empresa que no apareció
// HubSpot: datos y fit se toman del servidor. Lemlist: se guarda la tarjeta
// que vio el cliente (sanitizada). Queda en estado "new", aparece en
// /solicitudes-clientes y se envía de inmediato a la cuenta Lemlist del
// cliente (lista "Wishlist BullsEye").
export async function POST(req: NextRequest) {
  const { user, response } = await requirePortalUser();
  if (!user) return response;

  const body = await req.json().catch(() => null);
  const db = supabaseAdmin();
  let card: CompanyCard | null = null;
  let lemlistFields: LemlistCompanyFields = {};
  let source: "hubspot" | "lemlist" | "manual";
  let sourceRef: string | null = null;
  let mode: "manual" | "ai" = body?.mode === "ai" ? "ai" : "manual";
  let comment: string | null = null;

  if (body?.manual) {
    const m = body.manual as Record<string, unknown>;
    const name = str(m.name, 200);
    const linkedin = str(m.linkedin_url, 300);
    const domain = normalizeDomain(str(m.website, 300));
    if (!name) return NextResponse.json({ error: "Indica el nombre de la empresa" }, { status: 400 });
    if (!domain && !linkedin) return NextResponse.json({ error: "Indica el sitio web o el LinkedIn de la empresa" }, { status: 400 });
    comment = str(m.comment, 1000);
    source = "manual";
    mode = "manual";
    card = {
      source: "lemlist",
      key: domain ?? linkedin ?? name,
      name,
      domain,
      linkedin_url: linkedin,
      facts: comment ? [{ label: "Comentario del cliente", value: comment }] : [],
    };
  } else {
    const id = decodeRef(body?.ref);
    if (!id) return NextResponse.json({ error: "Empresa inválida" }, { status: 400 });
    source = id.source;
    sourceRef = id.key;
    if (id.source === "hubspot") {
      const [{ data: row }, props] = await Promise.all([
        db.from("hubspot_company_pool").select("hs_id, name, domain, properties").eq("hs_id", id.key).maybeSingle(),
        listPoolProperties(db),
      ]);
      if (row) {
        card = poolCompanyToCard(row, props);
        lemlistFields = poolCompanyLemlistFields(row, props);
      }
    } else {
      const c = (body?.card ?? {}) as Record<string, unknown>;
      const name = str(c.name, 200);
      if (name) {
        card = {
          source: "lemlist",
          key: id.key,
          name,
          domain: normalizeDomain(str(c.domain, 300)),
          linkedin_url: str(c.linkedin_url, 300),
          facts: (Array.isArray(c.facts) ? c.facts : []).slice(0, 10).map((f: { label?: unknown; value?: unknown }) => ({
            label: String(f?.label ?? "").slice(0, 60),
            value: String(f?.value ?? "").slice(0, 400),
          })),
        };
        lemlistFields = cardLemlistFields(card);
      }
    }
  }
  if (!card) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });

  // Fit ya calculado para el ICP vigente (si el cliente lo vio puntuado)
  let fit: { fit_score: number; fit_reason: string } | null = null;
  if (source !== "manual") {
    const icpText = await getClientIcpText(db, user.clientId);
    if (icpText) {
      const { data } = await db
        .from("company_fit_scores")
        .select("fit_score, fit_reason")
        .eq("client_id", user.clientId)
        .eq("source", "unified")
        .eq("source_key", `${source}:${sourceRef}`)
        .eq("icp_hash", icpHash(icpText))
        .maybeSingle();
      fit = data;
    }
  }

  const { data, error } = await db
    .from("client_wishlist")
    .insert({
      client_id: user.clientId,
      company_name: card.name,
      domain: card.domain,
      linkedin_url: card.linkedin_url,
      source,
      source_ref: sourceRef,
      mode,
      fit_score: fit?.fit_score ?? null,
      fit_reason: fit?.fit_reason ?? null,
      snapshot: { facts: card.facts, lemlist_fields: lemlistFields, ...(comment ? { client_comment: comment } : {}) },
      status: "new",
      lemlist_status: "pendiente",
      requested_by: user.portalUserId,
      requested_by_email: user.email,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Esta empresa ya está en tu wishlist" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await markRecommendation(db, user.clientId, source, sourceRef, "added");

  // Envío a Lemlist: si falla, la empresa igual queda en la wishlist y
  // prospección ve el error (y puede reintentar) en /solicitudes-clientes
  const push = await pushWishlistItemToLemlist(db, data.id).catch((err) => ({ ok: false, error: String(err) }));
  return NextResponse.json({ ok: true, id: data.id, lemlist: push.ok ? "ok" : "pendiente" });
}
