import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWishlistActor } from "@/lib/portalAuth";
import { normalizeDomain } from "@/lib/hubspotPool";
import { loadClientLots } from "@/lib/wishlistLotesServer";
import { auditCompany, coreName, fullDomain, loadAuditContext } from "@/lib/centroProspeccion/recoAudit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Lotes de carga de la wishlist (solo el equipo; lib/wishlistLotes.ts):
//   GET  ?client_id=  lotes del cliente con su avance + lote de cada empresa
//   POST ?client_id=  { rows: [{ name, website? }] } revisión antes de cargar
//        un listado: qué empresas ya entraron en otro lote (y cuál), cuáles
//        son recomendaciones pendientes y cuáles calzan con lo ya trabajado o
//        excluido. No guarda nada.

export async function GET(req: NextRequest) {
  const { user, response } = await requireWishlistActor(req);
  if (!user) return response;
  if (!user.isOperator) return NextResponse.json({ error: "Solo el equipo" }, { status: 403 });
  try {
    return NextResponse.json(await loadClientLots(supabaseAdmin(), user.clientId), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

type Check = { i: number; estado: "nueva" | "en_lote" | "revisar"; lote?: string; status?: string; motivos?: string[] };
const STATUS_LABEL: Record<string, string> = {
  proposed: "pendiente de aprobación", rejected_by_client: "rechazada por el cliente", new: "aprobada", in_lemlist: "aprobada",
  in_progress: "en prospección", contacts_found: "con contactos", discarded: "descartada",
};

export async function POST(req: NextRequest) {
  const { user, response } = await requireWishlistActor(req);
  if (!user) return response;
  if (!user.isOperator) return NextResponse.json({ error: "Solo el equipo" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const raw: { name?: unknown; website?: unknown }[] = Array.isArray(body?.rows) ? body.rows.slice(0, 2000) : [];
  if (!raw.length) return NextResponse.json({ checks: [] });

  const db = supabaseAdmin();
  const [{ lots, byItem }, ctx, wl] = await Promise.all([
    loadClientLots(db, user.clientId),
    loadAuditContext(db, user.clientId, { pending: true }),
    db.from("client_wishlist").select("id, company_name, domain, status").eq("client_id", user.clientId).limit(20_000),
  ]);
  const lotName = new Map(lots.map((l) => [l.id, l.name]));
  const byDom = new Map<string, { id: string; status: string }>();
  const byCore = new Map<string, { id: string; status: string }>();
  for (const r of wl.data ?? []) {
    const d = fullDomain(r.domain);
    if (d) byDom.set(d, r);
    const c = coreName(r.company_name);
    if (c.length >= 3) byCore.set(c, r);
  }

  const checks: Check[] = raw.map((r, i) => {
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const dom = normalizeDomain(typeof r.website === "string" ? r.website : null);
    const hit = (dom && byDom.get(fullDomain(dom) ?? "")) || (name ? byCore.get(coreName(name)) : undefined);
    if (hit) return { i, estado: "en_lote", lote: lotName.get(byItem[hit.id]) ?? "otra carga", status: STATUS_LABEL[hit.status] ?? hit.status };
    if (!name && !dom) return { i, estado: "nueva" };
    const a = auditCompany(ctx, name || dom || "", dom);
    // Lo de la wishlist ya se informó arriba con su lote
    const motivos = a.reasons.filter((m) => !m.includes("ya está en la wishlist del cliente"));
    return motivos.length ? { i, estado: "revisar", motivos } : { i, estado: "nueva" };
  });
  return NextResponse.json({ checks });
}
