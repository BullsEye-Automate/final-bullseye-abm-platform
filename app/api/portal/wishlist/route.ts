import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requirePortalUser } from "@/lib/portalAuth";
import { listPoolProperties, normalizeDomain } from "@/lib/hubspotPool";
import { icpHash } from "@/lib/wishlistFit";
import { getClientIcpText, poolCompanyToCard, type CompanyCard } from "@/lib/wishlist";

export const dynamic = "force-dynamic";

// GET — wishlist del cliente de la sesión
export async function GET() {
  const { user, response } = await requirePortalUser();
  if (!user) return response;
  const { data, error } = await supabaseAdmin()
    .from("client_wishlist")
    .select("id, company_name, domain, linkedin_url, source, mode, fit_score, fit_reason, snapshot, status, requested_by_email, created_at")
    .eq("client_id", user.clientId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

// POST — { source, key, mode, card? } agrega una empresa a la wishlist.
// HubSpot: los datos y el fit se toman del servidor (pool + caché de fit).
// Lemlist: se guarda la tarjeta que vio el cliente (sanitizada).
// La empresa queda en estado "new" y aparece en /solicitudes-clientes.
export async function POST(req: NextRequest) {
  const { user, response } = await requirePortalUser();
  if (!user) return response;

  const body = await req.json().catch(() => null);
  const source = body?.source === "lemlist" ? "lemlist" : "hubspot";
  const mode = body?.mode === "ai" ? "ai" : "manual";
  const key = typeof body?.key === "string" ? body.key.slice(0, 200) : "";
  if (!key) return NextResponse.json({ error: "Empresa inválida" }, { status: 400 });

  const db = supabaseAdmin();
  let card: CompanyCard | null = null;

  if (source === "hubspot") {
    const [{ data: row }, props] = await Promise.all([
      db.from("hubspot_company_pool").select("hs_id, name, domain, properties").eq("hs_id", key).maybeSingle(),
      listPoolProperties(db),
    ]);
    if (row) card = poolCompanyToCard(row, props);
  } else {
    const c = body?.card ?? {};
    if (typeof c.name === "string" && c.name.trim()) {
      card = {
        source: "lemlist",
        key,
        name: c.name.trim().slice(0, 200),
        domain: normalizeDomain(typeof c.domain === "string" ? c.domain : null),
        linkedin_url: typeof c.linkedin_url === "string" ? c.linkedin_url.slice(0, 300) : null,
        facts: (Array.isArray(c.facts) ? c.facts : [])
          .slice(0, 8)
          .map((f: { label?: unknown; value?: unknown }) => ({
            label: String(f?.label ?? "").slice(0, 60),
            value: String(f?.value ?? "").slice(0, 400),
          })),
      };
    }
  }
  if (!card) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });

  // Fit ya calculado para el ICP vigente (si el cliente lo vio puntuado)
  const icpText = await getClientIcpText(db, user.clientId);
  const { data: fit } = icpText
    ? await db
        .from("company_fit_scores")
        .select("fit_score, fit_reason")
        .eq("client_id", user.clientId)
        .eq("source", source)
        .eq("source_key", key)
        .eq("icp_hash", icpHash(icpText))
        .maybeSingle()
    : { data: null };

  const { data, error } = await db
    .from("client_wishlist")
    .insert({
      client_id: user.clientId,
      company_name: card.name,
      domain: card.domain,
      linkedin_url: card.linkedin_url,
      source,
      source_ref: key,
      mode,
      fit_score: fit?.fit_score ?? null,
      fit_reason: fit?.fit_reason ?? null,
      snapshot: { facts: card.facts },
      status: "new",
      // Envío a Lemlist: pendiente hasta confirmar el endpoint de empresas
      // de Lemlist (ver CLAUDE.md → Portal de clientes → Wishlist)
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
  return NextResponse.json({ ok: true, id: data.id });
}
