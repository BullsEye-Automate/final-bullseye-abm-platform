import type { SupabaseClient } from "@supabase/supabase-js";
import { computeBill, lastDayOf, round2, toClp, type Bill, type BillMeeting } from "@/lib/acti/billing";
import { loadActiConfig, listActiMembers, type ActiMember } from "@/lib/acti/server";
import { chileToday } from "@/lib/acti/home";
import type { ActiConfig } from "@/lib/acti/plans";

// ACTI · facturación: datos (reuniones de la planilla + disputas del socio),
// valor de la UF y cierre mensual congelado en acti_billing_months.

// ── Valor UF (mindicador.cl; caché en allo_response_cache) ───────────────

export async function ufValue(db: SupabaseClient, dateIso: string): Promise<number | null> {
  const key = `acti_uf:${dateIso}`;
  const { data: hit } = await db.from("allo_response_cache").select("response").eq("cache_key", key).maybeSingle();
  const cached = (hit?.response as { valor?: number } | undefined)?.valor;
  if (cached) return cached;
  const [y, m, d] = dateIso.split("-");
  try {
    const res = await fetch(`https://mindicador.cl/api/uf/${d}-${m}-${y}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { serie?: { valor?: number }[] };
    const valor = j.serie?.[0]?.valor;
    if (!valor) return null;
    await db.from("allo_response_cache").upsert(
      { cache_key: key, response: { valor, fuente: "mindicador.cl" }, expires_at: new Date(Date.now() + 400 * 86_400_000).toISOString() },
      { onConflict: "cache_key" }
    );
    return valor;
  } catch {
    return null;
  }
}

// ── Reuniones del mes del socio ──────────────────────────────────────────

export async function billMeetings(db: SupabaseClient, clientId: string, month: string): Promise<BillMeeting[]> {
  const from = `${month}-01`;
  const to = lastDayOf(month);
  const sel = "id, empresa, fecha_reunion, fecha_agendamiento, realizado";
  // Por fecha de la reunión o de agendamiento (según la regla del variable)
  const [{ data: a }, { data: b }] = await Promise.all([
    db.from("meetings").select(sel).eq("client_id", clientId).gte("fecha_reunion", from).lte("fecha_reunion", to),
    db.from("meetings").select(sel).eq("client_id", clientId).gte("fecha_agendamiento", from).lte("fecha_agendamiento", to),
  ]);
  const byId = new Map<string, BillMeeting>();
  for (const m of [...(a ?? []), ...(b ?? [])] as BillMeeting[]) byId.set(m.id, m);
  const ids = [...byId.keys()];
  if (ids.length) {
    const { data: fb } = await db.from("acti_meeting_feedback").select("meeting_id, disputa").in("meeting_id", ids);
    for (const f of (fb ?? []) as { meeting_id: string; disputa: BillMeeting["disputa"] }[]) {
      const m = byId.get(f.meeting_id);
      if (m) m.disputa = f.disputa;
    }
  }
  return [...byId.values()];
}

export type BillView = Bill & {
  closed: boolean;
  ufValue: number | null;
  ufDate: string | null;
  totalClp: number | null;
  revenueShareClp: number | null;
  closedAt: string | null;
};

type ClosedRow = {
  month: string; plan: string; base_uf: number; per_meeting_uf: number; meetings_charged: number; meetings_done: number;
  meetings_no_show: number; meetings_disputed: number; variable_uf: number; subtotal_uf: number; iva_pct: number; iva_uf: number;
  total_uf: number; uf_value: number | null; uf_date: string | null; total_clp: number | null; revenue_share_pct: number;
  revenue_share_uf: number; revenue_share_clp: number | null; detail: { lines?: Bill["lines"] }; closed_at: string;
};

const fromRow = (r: ClosedRow): BillView => ({
  month: r.month,
  plan: r.plan,
  free: Number(r.base_uf) === 0 && Number(r.per_meeting_uf) === 0,
  baseUf: Number(r.base_uf),
  perMeetingUf: Number(r.per_meeting_uf),
  meetingsCharged: r.meetings_charged,
  meetingsDone: r.meetings_done,
  meetingsNoShow: r.meetings_no_show,
  meetingsDisputed: r.meetings_disputed,
  variableUf: Number(r.variable_uf),
  subtotalUf: Number(r.subtotal_uf),
  ivaPct: Number(r.iva_pct),
  ivaUf: Number(r.iva_uf),
  totalUf: Number(r.total_uf),
  revenueSharePct: Number(r.revenue_share_pct),
  revenueShareUf: Number(r.revenue_share_uf),
  lines: r.detail?.lines ?? [],
  closed: true,
  ufValue: r.uf_value === null ? null : Number(r.uf_value),
  ufDate: r.uf_date,
  totalClp: r.total_clp === null ? null : Number(r.total_clp),
  revenueShareClp: r.revenue_share_clp === null ? null : Number(r.revenue_share_clp),
  closedAt: r.closed_at,
});

// Mes en curso (en vivo) con la UF de hoy como referencia
export async function liveBill(db: SupabaseClient, member: ActiMember, config: ActiConfig, month: string): Promise<BillView> {
  const bill = computeBill(config.plans[member.plan], config.params, member.status, await billMeetings(db, member.client_id, month), month);
  const today = chileToday();
  const date = lastDayOf(month) < today ? lastDayOf(month) : today;
  const uf = bill.totalUf > 0 || bill.revenueShareUf > 0 ? await ufValue(db, date) : null;
  return {
    ...bill,
    closed: false,
    ufValue: uf,
    ufDate: uf ? date : null,
    totalClp: toClp(bill.totalUf, uf),
    revenueShareClp: toClp(bill.revenueShareUf, uf),
    closedAt: null,
  };
}

export async function closedBills(db: SupabaseClient, clientId: string): Promise<BillView[]> {
  const { data } = await db
    .from("acti_billing_months")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "cerrado")
    .order("month", { ascending: false })
    .limit(36);
  return ((data ?? []) as ClosedRow[]).map(fromRow);
}

export async function billForMonth(db: SupabaseClient, member: ActiMember, config: ActiConfig, month: string): Promise<BillView> {
  const { data } = await db.from("acti_billing_months").select("*").eq("client_id", member.client_id).eq("month", month).eq("status", "cerrado").maybeSingle();
  return data ? fromRow(data as ClosedRow) : liveBill(db, member, config, month);
}

// Cierra (o vuelve a cerrar) un mes para todos los socios. Congela los montos
// con la configuración vigente y la UF del último día del mes (o la indicada).
export async function closeMonth(db: SupabaseClient, month: string, by: string, opts: { ufOverride?: number | null; onlyClientId?: string } = {}) {
  const config = await loadActiConfig(db);
  const { members } = await listActiMembers(db);
  const date = lastDayOf(month);
  const uf = opts.ufOverride ?? (await ufValue(db, date));
  const out: { client_id: string; total_uf: number }[] = [];
  for (const m of members) {
    if (opts.onlyClientId && m.client_id !== opts.onlyClientId) continue;
    // Socios que entraron después del mes no se facturan
    if (m.joined_at > date) continue;
    const bill = computeBill(config.plans[m.plan], config.params, m.status, await billMeetings(db, m.client_id, month), month);
    const row = {
      client_id: m.client_id,
      month,
      plan: m.plan,
      member_status: m.status,
      base_uf: bill.baseUf,
      per_meeting_uf: bill.perMeetingUf,
      meetings_charged: bill.meetingsCharged,
      meetings_done: bill.meetingsDone,
      meetings_no_show: bill.meetingsNoShow,
      meetings_disputed: bill.meetingsDisputed,
      variable_uf: bill.variableUf,
      subtotal_uf: bill.subtotalUf,
      iva_pct: bill.ivaPct,
      iva_uf: bill.ivaUf,
      total_uf: bill.totalUf,
      uf_value: uf,
      uf_date: uf ? date : null,
      total_clp: toClp(bill.totalUf, uf),
      revenue_share_pct: bill.revenueSharePct,
      revenue_share_uf: bill.revenueShareUf,
      revenue_share_clp: toClp(bill.revenueShareUf, uf),
      detail: { lines: bill.lines },
      status: "cerrado",
      closed_by: by,
      closed_at: new Date().toISOString(),
    };
    const { error } = await db.from("acti_billing_months").upsert(row, { onConflict: "client_id,month" });
    if (error) throw new Error(error.message);
    out.push({ client_id: m.client_id, total_uf: bill.totalUf });
  }
  return { month, uf, closed: out.length, totalUf: round2(out.reduce((s, r) => s + r.total_uf, 0)) };
}

// Resumen del mes para el equipo (todos los socios): cerrado si existe, si no en vivo
export async function monthOverview(db: SupabaseClient, month: string) {
  const config = await loadActiConfig(db);
  const { members } = await listActiMembers(db);
  const ids = members.map((m) => m.client_id);
  const [{ data: clients }, { data: closed }] = await Promise.all([
    ids.length ? db.from("clients").select("id, name").in("id", ids) : Promise.resolve({ data: [] }),
    db.from("acti_billing_months").select("*").eq("month", month).eq("status", "cerrado"),
  ]);
  const names = new Map(((clients ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const closedBy = new Map(((closed ?? []) as (ClosedRow & { client_id: string })[]).map((r) => [r.client_id, fromRow(r)]));
  const rows: (BillView & { clientId: string; clientName: string })[] = [];
  for (const m of members) {
    if (m.joined_at > lastDayOf(month)) continue;
    const b = closedBy.get(m.client_id) ?? (await liveBill(db, m, config, month));
    rows.push({ ...b, clientId: m.client_id, clientName: names.get(m.client_id) ?? "—" });
  }
  rows.sort((a, b) => b.totalUf - a.totalUf || a.clientName.localeCompare(b.clientName));
  const sum = (k: "baseUf" | "variableUf" | "totalUf" | "revenueShareUf" | "meetingsCharged" | "meetingsNoShow" | "meetingsDisputed") =>
    round2(rows.reduce((s, r) => s + Number(r[k] ?? 0), 0));
  return {
    month,
    closed: rows.length > 0 && rows.every((r) => r.closed),
    rows,
    totals: {
      baseUf: sum("baseUf"),
      variableUf: sum("variableUf"),
      totalUf: sum("totalUf"),
      revenueShareUf: sum("revenueShareUf"),
      meetingsCharged: sum("meetingsCharged"),
      meetingsNoShow: sum("meetingsNoShow"),
      meetingsDisputed: sum("meetingsDisputed"),
    },
  };
}
