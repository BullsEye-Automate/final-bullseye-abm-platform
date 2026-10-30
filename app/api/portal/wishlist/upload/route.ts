import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWishlistActor } from "@/lib/portalAuth";
import { normalizeDomain } from "@/lib/hubspotPool";
import { pushWishlistItemToLemlist } from "@/lib/wishlistLemlist";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { rows: [{ name, website?, linkedin_url? }] } — listado de empresas que
// el cliente ya eligió por su cuenta (Excel / CSV en su portal). Quedan
// aprobadas para prospectar de inmediato (origin client, status new) y se
// envían a su Lemlist; el cron de contactos las toma desde ahí. El navegador
// manda el archivo en tandas de hasta MAX_ROWS filas.
// Si la empresa era una propuesta de BullsEye pendiente (o rechazada), subirla
// cuenta como aprobación. Solo para el cliente: el equipo propone desde Empresas.

const MAX_ROWS = 25;
const CONCURRENCY = 4;

type Row = { name: string; domain: string | null; linkedin: string | null };
type Result = { name: string; result: "added" | "approved" | "duplicate" | "invalid" | "error"; error?: string };

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const normLinkedin = (v: string | null) => {
  if (!v) return null;
  const t = v.trim();
  if (!/linkedin\.com\//i.test(t)) return null;
  return t.startsWith("http") ? t : `https://${t.replace(/^\/+/, "")}`;
};

export async function POST(req: NextRequest) {
  const { user, response } = await requireWishlistActor(req);
  if (!user) return response;
  if (user.isOperator) return NextResponse.json({ error: "El equipo propone empresas desde Empresas" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const raw: unknown[] = Array.isArray(body?.rows) ? body.rows.slice(0, MAX_ROWS) : [];
  if (!raw.length) return NextResponse.json({ error: "No hay empresas en el listado" }, { status: 400 });

  const results: Result[] = [];
  const rows: Row[] = [];
  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>;
    const domain = normalizeDomain(str(o.website, 300));
    const linkedin = normLinkedin(str(o.linkedin_url, 300));
    const name = str(o.name, 200) ?? domain;
    if (!name) {
      results.push({ name: "—", result: "invalid", error: "Fila sin nombre ni sitio web" });
      continue;
    }
    rows.push({ name, domain, linkedin });
  }

  const db = supabaseAdmin();
  const { data: existing, error: exErr } = await db
    .from("client_wishlist")
    .select("id, company_name, domain, status")
    .eq("client_id", user.clientId);
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  const byDomain = new Map<string, { id: string; status: string }>();
  const byName = new Map<string, { id: string; status: string }>();
  for (const e of existing ?? []) {
    if (e.domain) byDomain.set(e.domain, e);
    byName.set(e.company_name.trim().toLowerCase(), e);
  }

  const now = new Date().toISOString();
  const toPush: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const key = r.domain ?? r.name.toLowerCase();
    if (seen.has(key)) {
      results.push({ name: r.name, result: "duplicate" });
      continue;
    }
    seen.add(key);
    const prev = (r.domain && byDomain.get(r.domain)) || byName.get(r.name.toLowerCase());
    if (prev) {
      // Propuesta de BullsEye pendiente o rechazada: subirla = aprobarla
      if (prev.status === "proposed" || prev.status === "rejected_by_client") {
        const { error } = await db
          .from("client_wishlist")
          .update({ status: "new", lemlist_status: "pendiente", client_decision_at: now, client_decision_by_email: user.email, client_reject_reason: null, updated_at: now })
          .eq("id", prev.id);
        if (error) results.push({ name: r.name, result: "error", error: error.message });
        else {
          results.push({ name: r.name, result: "approved" });
          toPush.push(prev.id);
        }
      } else {
        results.push({ name: r.name, result: "duplicate" });
      }
      continue;
    }
    const { data, error } = await db
      .from("client_wishlist")
      .insert({
        client_id: user.clientId,
        company_name: r.name,
        domain: r.domain,
        linkedin_url: r.linkedin,
        source: "manual",
        source_ref: null,
        mode: "manual",
        snapshot: { facts: [{ label: "Origen", value: "Listado subido por el cliente" }], uploaded: true },
        status: "new",
        origin: "client",
        lemlist_status: "pendiente",
        requested_by: user.portalUserId,
        requested_by_email: user.email,
      })
      .select("id")
      .single();
    if (error) {
      results.push({ name: r.name, result: error.code === "23505" ? "duplicate" : "error", ...(error.code === "23505" ? {} : { error: error.message }) });
      continue;
    }
    results.push({ name: r.name, result: "added" });
    toPush.push(data.id);
  }

  // Envío a Lemlist en paralelo acotado; si falla, la empresa igual queda
  // aprobada y prospección la reintenta desde el Dashboard
  for (let i = 0; i < toPush.length; i += CONCURRENCY) {
    await Promise.all(toPush.slice(i, i + CONCURRENCY).map((id) => pushWishlistItemToLemlist(db, id).catch(() => null)));
  }

  return NextResponse.json({ results });
}
