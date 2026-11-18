import { NextRequest, NextResponse } from "next/server";
import { isCentroOwner, requireCentroUser } from "@/lib/centroProspeccion/access";
import { loadClientLinks } from "@/lib/centroProspeccion/portalLink";
import { auditCompany, loadAuditContext, withAuditFact, type AuditResult } from "@/lib/centroProspeccion/recoAudit";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Revisión de las recomendaciones IA ya guardadas (pedido de BullsEye,
// 17-nov-2026), con las mismas reglas que se aplican al generarlas
// (lib/centroProspeccion/recoAudit.ts):
//   GET  ?desde=AAAA-MM-DD  vista previa: qué se ocultaría y qué llevaría nota.
//   POST ?desde=AAAA-MM-DD  aplica (solo la líder del Centro): las seguras pasan
//        a "excluded" (no se muestran) y las dudosas quedan con nota.
// Dentro de un mismo cliente, si una empresa está repetida se conserva la de
// mayor fit.

type Reco = { id: string; client_id: string; company_name: string; domain: string | null; fit_score: number; status: string; facts: { label: string; value: string }[] | null };

async function run(desde: string, apply: boolean) {
  const db = supabaseAdmin();
  const recos: Reco[] = [];
  for (let f = 0; f < 50_000; f += 1000) {
    const { data, error } = await db
      .from("client_recommendations")
      .select("id, client_id, company_name, domain, fit_score, status, facts")
      .eq("status", "pending")
      .gte("created_at", `${desde}T03:00:00Z`)
      .range(f, f + 999);
    if (error) throw new Error(error.message);
    recos.push(...((data ?? []) as Reco[]));
    if (!data || data.length < 1000) break;
  }
  const links = await loadClientLinks();
  const name = new Map(links.clients.map((c) => [c.id, c.name]));
  const byClient = new Map<string, Reco[]>();
  for (const r of recos) byClient.set(r.client_id, [...(byClient.get(r.client_id) ?? []), r]);

  const out = [];
  for (const [clientId, list] of byClient) {
    // Sin las pendientes en el contexto: se agregan de a una, de mayor a menor fit
    const ctx = await loadAuditContext(db, clientId, { pending: false });
    list.sort((a, b) => b.fit_score - a.fit_score);
    const ocultas: { empresa: string; motivo: string }[] = [];
    const notas: { empresa: string; nota: string }[] = [];
    for (const r of list) {
      const v: AuditResult = auditCompany(ctx, r.company_name, r.domain);
      ctx.add(r.company_name, r.domain, v.level === "block" ? "ya recomendada" : "repetida en las recomendaciones de esta semana");
      if (v.level === "block") ocultas.push({ empresa: r.company_name, motivo: v.reasons.join(" · ") });
      if (v.level === "note") notas.push({ empresa: r.company_name, nota: v.reasons.join(" · ") });
      if (!apply) continue;
      const facts = withAuditFact(Array.isArray(r.facts) ? r.facts : [], v);
      const patch: Record<string, unknown> = { facts, updated_at: new Date().toISOString() };
      if (v.level === "block") patch.status = "excluded";
      const changed = v.level === "block" || JSON.stringify(facts) !== JSON.stringify(r.facts ?? []);
      if (changed) {
        const { error } = await db.from("client_recommendations").update(patch).eq("id", r.id).eq("status", "pending");
        if (error) throw new Error(error.message);
      }
    }
    out.push({ cliente: name.get(clientId) ?? clientId, total: list.length, ocultas, notas });
  }
  out.sort((a, b) => b.ocultas.length + b.notas.length - (a.ocultas.length + a.notas.length));
  return { desde, aplicado: apply, total: recos.length, ocultas: out.reduce((s, c) => s + c.ocultas.length, 0), notas: out.reduce((s, c) => s + c.notas.length, 0), clientes: out };
}

export async function GET(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const desde = req.nextUrl.searchParams.get("desde") ?? "2026-11-15";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return NextResponse.json({ error: "desde inválido" }, { status: 400 });
  try {
    return NextResponse.json(await run(desde, false), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  if (!isCentroOwner(u.email)) return NextResponse.json({ error: "Solo la líder del Centro puede aplicar la revisión" }, { status: 403 });
  const desde = req.nextUrl.searchParams.get("desde") ?? "2026-11-15";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return NextResponse.json({ error: "desde inválido" }, { status: 400 });
  try {
    return NextResponse.json(await run(desde, true));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
