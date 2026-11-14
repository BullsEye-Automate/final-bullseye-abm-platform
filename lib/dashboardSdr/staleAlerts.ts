import { supabaseAdmin } from "@/lib/supabase";
import { sendMail } from "@/lib/mailer";
import { normalizeSdrName } from "@/lib/sdrAnalytics";
import { addDays, chileToday, dow, isBusinessDay } from "@/lib/celulasSdr/calendar";
import { CC_ALWAYS, TEST_RECIPIENT, leaderEmail } from "@/lib/celulasSdr/server/alertsMail";
import { readMasterPeople, resolveSdr } from "@/lib/respuestasLemlist/directory";
import { buildAll, NO_SDR_KEY } from "./server";
import { STALE_BUSINESS_DAYS } from "./stale";
import { analyze, FIX_KINDS, type Analysis, type FixItem } from "./compute";

// Correo semanal "Por corregir" del Dashboard SDR (nov-2026, pedido de
// BullsEye; partió como alerta de cuentas estancadas y se unificó con el resto
// de "Por corregir"). Mismo cálculo del dashboard (./compute.ts): cuentas
// estancadas (15+ días hábiles en Asignada), seguimientos vencidos, status
// desactualizados y reuniones por actualizar. Una vez por semana (primer día
// hábil, ~9:00 de Chile):
//  - a cada SDR: su lista,
//  - a cada líder de célula: resumen por SDR de su célula + las cuentas
//    estancadas más antiguas, con copia a CC_ALWAYS. Los SDR sin célula
//    identificada van a CC_ALWAYS.
// Modo STALE_ALERTS_MODE: "test" por defecto (todo a TEST_RECIPIENT con los
// destinatarios reales en el cuerpo); "activo" = envío real.
// Remitente: STALE_ALERTS_FROM → CELULAS_ALERTS_FROM.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://portal.bullseye-abm.com";
const MAX_ROWS_SDR = 150;
const MAX_ROWS_LEADER = 40;

type Planned = { kind: "sdr" | "lider" | "sin_celula"; name: string; to: string[]; cc: string[]; subject: string; html: string; count: number };
export type StaleRunResult = {
  mode: "test" | "activo";
  today: string;
  sent: boolean;
  skippedReason?: string;
  mails: { kind: Planned["kind"]; name: string; to: string[]; cc: string[]; subject: string; count: number; status: "sent" | "error" | "preview"; error?: string }[];
  notes: string[];
};

const esc = (s: string) => (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const TH = 'style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;font-size:12px;color:#555"';
const TD = 'style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px"';
const TDN = 'style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;text-align:right"';

function wrap(title: string, intro: string, inner: string, link: string, testNote: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:760px">
${testNote}<h2 style="color:#251762;font-size:18px;margin:0 0 8px">${esc(title)}</h2>
<p style="font-size:14px;line-height:1.5">${intro}</p>
${inner}
<p style="margin:18px 0"><a href="${link}" style="background:#251762;color:#fff;text-decoration:none;padding:9px 14px;border-radius:8px;font-size:13px">Ver en el Dashboard SDR</a></p>
<p style="font-size:11px;color:#888;line-height:1.5">Cuenta estancada = empresa con «Status de la asignación» en Asignada ${STALE_BUSINESS_DAYS} días hábiles o más (lunes a viernes, sin feriados de Chile) desde su fecha de asignación en HubSpot. Si el HubSpot del cliente no tiene la propiedad «Fecha de asignación», se usa la fecha de creación de la empresa. Datos de Pulso ABM (última sincronización con HubSpot).</p>
</div>`;
}

const sentKey = (week: string) => `cuentas_estancadas_sent:${week}`;
async function wasSent(week: string): Promise<boolean> {
  const { data } = await supabaseAdmin().from("allo_response_cache").select("cache_key").eq("cache_key", sentKey(week)).maybeSingle();
  return !!data;
}
async function markSent(week: string, info: unknown): Promise<void> {
  const { error } = await supabaseAdmin().from("allo_response_cache").upsert(
    { cache_key: sentKey(week), response: { sentAt: new Date().toISOString(), ...(info as object) }, expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString() },
    { onConflict: "cache_key" }
  );
  if (error) console.error("Cuentas estancadas: no se pudo registrar el envío:", error.message);
}

// Lunes de la semana de `day`
function weekOf(day: string): string {
  return addDays(day, -((dow(day) + 6) % 7));
}
// ¿Es `day` el primer día hábil de su semana? (si el lunes es feriado, el martes)
function firstBusinessDayOfWeek(day: string): boolean {
  if (!isBusinessDay(day)) return false;
  for (let d = weekOf(day); d < day; d = addDays(d, 1)) if (isBusinessDay(d)) return false;
  return true;
}
function chileHour(): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", hour: "2-digit", hour12: false }).format(new Date())) % 24;
}

async function planMails(today: string, live: boolean, notes: string[]): Promise<Planned[]> {
  const { idx, slices } = await buildAll(today);
  const people = await readMasterPeople();
  const testNote = (to: string[], cc: string[]) =>
    live ? "" : `<div style="background:#FAEEDA;border:1px solid #E8C98F;padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:12px">Modo prueba: en envío real este correo iría a <b>${esc(to.join(", ") || "—")}</b>${cc.length ? ` con copia a ${esc(cc.join(", "))}` : ""}.</div>`;
  const plural = (n: number, s: string, p = s + "s") => `${n} ${n === 1 ? s : p}`;

  // Análisis de cada SDR (el mismo cálculo del dashboard)
  const byKey = new Map<string, { name: string; a: Analysis }>();
  for (const s of slices.values()) {
    if (s.key === NO_SDR_KEY) continue;
    const a = analyze(s, today);
    if (a.fixes.length) byKey.set(s.key, { name: s.name, a });
  }

  const section = (title: string, items: FixItem[], max: number, cols: [string, (f: FixItem) => string][]) => {
    if (!items.length) return "";
    const head = cols.map(([h]) => `<th ${TH}>${esc(h)}</th>`).join("");
    const body = items.slice(0, max).map((f) => `<tr>${cols.map(([, get], i) => `<td ${TD}>${i === 0 ? `<b>${esc(get(f))}</b>` : esc(get(f))}</td>`).join("")}</tr>`).join("");
    const more = items.length > max ? `<tr><td ${TD} colspan="${cols.length}" style="color:#777">… y ${items.length - max} más en el dashboard</td></tr>` : "";
    return `<h3 style="margin:18px 0 6px;font-size:15px;color:#251762">${esc(title)} (${items.length})</h3><table style="border-collapse:collapse;width:100%"><tr>${head}</tr>${body}${more}</table>`;
  };
  const who = (f: FixItem) => (f.sub ? `${f.who} · ${f.sub}` : f.who);
  const countsTable = (a: Analysis) => `<table style="border-collapse:collapse;width:100%">${FIX_KINDS.map((k) => {
    const n = a.fixBy[k.id].length;
    return n ? `<tr><td style="width:44px;padding:6px 8px;border-bottom:1px solid #eee;font-size:20px;font-weight:700;color:#854F0B;text-align:right">${n}</td><td ${TD}><b>${esc(k.label)}</b><br><span style="color:#777">${esc(k.help)}</span></td></tr>` : "";
  }).join("")}</table>`;

  const mails: Planned[] = [];
  // 1) Cada SDR: su lista
  for (const [key, { name, a }] of byKey) {
    const r = resolveSdr(people, name);
    if (!r.ok) { notes.push(`${name}: sin correo de SDR (${r.reason}). Va solo en el resumen de su líder.`); continue; }
    const to = [r.person.email!];
    const inner = countsTable(a)
      + section("Cuentas estancadas", a.fixBy.est, MAX_ROWS_SDR, [["Empresa", (f) => f.who], ["Cliente", (f) => f.client], ["En Asignada", (f) => f.since], ["Qué hacer", (f) => f.todo]])
      + section("Seguimientos vencidos", a.fixBy.seg, 40, [["Empresa / contacto", who], ["Cliente", (f) => f.client], ["Vencido", (f) => f.since.replace("Vencido el ", "")]])
      + section("Status desactualizados", a.fixBy.sta, 40, [["Empresa", who], ["Cliente", (f) => f.client], ["Qué hacer", (f) => f.todo]])
      + section("Reuniones por actualizar", [...a.fixBy.reu, ...a.fixBy.hs], 40, [["Empresa", who], ["Cliente", (f) => f.client], ["Qué falta", (f) => f.what]]);
    mails.push({
      kind: "sdr", name, to, cc: [], count: a.fixes.length,
      subject: `Tienes ${plural(a.fixes.length, "cosa por corregir", "cosas por corregir")} esta semana`,
      html: wrap(`Hola ${name.split(" ")[0]}: esto quedó pendiente en tu cartera`,
        "Gestiónalo o actualiza el status en HubSpot (o la reunión en la planilla). El dashboard se actualiza con la sincronización diaria de Pulso ABM.",
        inner, `${APP_URL}/sdr/dashboard?sdr=${encodeURIComponent(key)}`, testNote(to, [])),
    });
  }

  // 2) Cada líder: su célula (todos sus SDR, con o sin pendientes)
  const leaders = new Map<string, typeof idx.index>();
  const noCell: typeof idx.index = [];
  for (const row of idx.index) {
    if (row.key === NO_SDR_KEY) continue;
    const s = row.summary;
    const has = s.est + s.seg + s.sta + s.reu + s.hs > 0;
    const email = row.cell ? leaderEmail(row.cell) : null;
    if (!row.cell || !email) { if (has) noCell.push(row); continue; }
    leaders.set(row.cell, [...(leaders.get(row.cell) ?? []), row]);
  }
  const cellTable = (rows: typeof idx.index) => {
    const sorted = [...rows].sort((a, b) => (b.summary.est + b.summary.seg) - (a.summary.est + a.summary.seg));
    const avg = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0) / Math.max(1, rows.length);
    const cell = (v: number, av: number) => (v > av ? `<td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;text-align:right;color:#993C1D;font-weight:700">${v}</td>` : `<td ${TDN}>${v}</td>`);
    const fs = [(r: (typeof rows)[number]) => r.summary.est, (r: (typeof rows)[number]) => r.summary.seg, (r: (typeof rows)[number]) => r.summary.sta, (r: (typeof rows)[number]) => r.summary.reu + r.summary.hs];
    const avgs = fs.map(avg);
    return `<table style="border-collapse:collapse;width:100%"><tr><th ${TH}>SDR</th><th ${TH}>Estancadas</th><th ${TH}>Seguim. vencidos</th><th ${TH}>Status desact.</th><th ${TH}>Reuniones por actualizar</th><th ${TH}>Más antigua</th></tr>${sorted
      .map((r) => `<tr><td ${TD}><b>${esc(r.name)}</b></td>${fs.map((f, i) => cell(f(r), avgs[i])).join("")}<td ${TDN}>${r.summary.oldest[0] ? `${r.summary.oldest[0].d} días` : "—"}</td></tr>`).join("")}</table>`;
  };
  const oldestTable = (rows: typeof idx.index) => {
    const list = rows.flatMap((r) => r.summary.oldest.map((o) => ({ ...o, sdr: r.name }))).sort((a, b) => b.d - a.d).slice(0, MAX_ROWS_LEADER);
    if (!list.length) return "";
    return `<h3 style="margin:18px 0 6px;font-size:15px;color:#251762">Cuentas estancadas más antiguas</h3><table style="border-collapse:collapse;width:100%"><tr><th ${TH}>Empresa</th><th ${TH}>SDR</th><th ${TH}>Cliente</th><th ${TH}>Días hábiles</th></tr>${list
      .map((o) => `<tr><td ${TD}><b>${esc(o.n)}</b></td><td ${TD}>${esc(o.sdr)}</td><td ${TD}>${esc(o.c)}</td><td ${TDN}><b>${o.d}</b></td></tr>`).join("")}</table>`;
  };
  const sum = (rows: typeof idx.index, f: (s: (typeof rows)[number]["summary"]) => number) => rows.reduce((s, r) => s + f(r.summary), 0);
  for (const [leader, rows] of leaders) {
    const est = sum(rows, (s) => s.est), seg = sum(rows, (s) => s.seg);
    if (!est && !seg && !sum(rows, (s) => s.sta + s.reu + s.hs)) continue;
    const to = [leaderEmail(leader)!];
    const cc = CC_ALWAYS.filter((x) => !to.includes(x));
    const mtg = `<p style="font-size:14px;line-height:1.5;margin:16px 0 0"><b>Reuniones de la célula este mes:</b> ${sum(rows, (s) => s.ag)} agendadas · ${sum(rows, (s) => s.re)} realizadas · ${sum(rows, (s) => s.ns)} no-show · ${sum(rows, (s) => s.pe)} pendientes.</p>`;
    mails.push({
      kind: "lider", name: leader, to, cc, count: est + seg,
      subject: `Tu célula tiene ${plural(est, "cuenta estancada", "cuentas estancadas")} y ${plural(seg, "seguimiento vencido", "seguimientos vencidos")}`,
      html: wrap("Pendientes de tu célula", "Por SDR, lo que quedó por corregir. Cada SDR recibió hoy su propia lista. En rojo, lo que está sobre el promedio de la célula.",
        cellTable(rows) + oldestTable(rows) + mtg, `${APP_URL}/sdr/dashboard?vista=celula`, testNote(to, cc)),
    });
  }

  // 3) SDR sin célula identificada → CC_ALWAYS
  if (noCell.length) {
    const to = [...CC_ALWAYS];
    mails.push({
      kind: "sin_celula", name: "Sin célula", to, cc: [], count: sum(noCell, (s) => s.est + s.seg),
      subject: `Pendientes de ${plural(noCell.length, "SDR")} sin célula en la Maestra`,
      html: wrap("Pendientes sin líder que los reciba", "Estos SDR no tienen célula (o líder con correo) en la Maestra.",
        cellTable(noCell) + oldestTable(noCell), `${APP_URL}/sdr/dashboard?vista=celula`, testNote(to, [])),
    });
  }
  return mails;
}

export async function runStaleAlerts(opts: { force?: boolean; preview?: boolean; testOnly?: boolean } = {}): Promise<StaleRunResult> {
  const today = chileToday();
  const live = process.env.STALE_ALERTS_MODE === "activo" && !opts.testOnly;
  const mode = live ? "activo" : "test";
  const week = weekOf(today);
  if (!opts.force && !opts.preview) {
    if (!firstBusinessDayOfWeek(today)) return { mode, today, sent: false, skippedReason: "Hoy no es el primer día hábil de la semana", mails: [], notes: [] };
    const h = chileHour();
    if (h < 9 || h >= 11) return { mode, today, sent: false, skippedReason: `Fuera de horario (${h}:00 en Chile)`, mails: [], notes: [] };
    if (await wasSent(week)) return { mode, today, sent: false, skippedReason: "Ya se envió esta semana", mails: [], notes: [] };
  }

  const notes: string[] = [];
  const planned = await planMails(today, live, notes);
  if (opts.preview) {
    return { mode, today, sent: false, mails: planned.map(({ html: _h, ...m }) => ({ ...m, status: "preview" as const })), notes };
  }

  const from = process.env.STALE_ALERTS_FROM || process.env.CELULAS_ALERTS_FROM || "onboarding@resend.dev";
  const out: StaleRunResult["mails"] = [];
  for (const m of planned) {
    const to = live ? m.to : [TEST_RECIPIENT];
    const cc = live ? m.cc : [];
    try {
      await sendMail({ from, fromName: "BullsEye · Por corregir", to, cc, subject: live ? m.subject : `[Prueba] ${m.subject}`, html: m.html });
      out.push({ kind: m.kind, name: m.name, to, cc, subject: m.subject, count: m.count, status: "sent" });
    } catch (e) {
      out.push({ kind: m.kind, name: m.name, to, cc, subject: m.subject, count: m.count, status: "error", error: (e as Error).message });
    }
  }
  if (!opts.force) await markSent(week, { mode, mails: out.length });
  return { mode, today, sent: true, mails: out, notes };
}

// Vista previa del correo de un destinatario (para la página)
export async function previewStaleMail(name: string): Promise<string | null> {
  const notes: string[] = [];
  const planned = await planMails(chileToday(), process.env.STALE_ALERTS_MODE === "activo", notes);
  const n = normalizeSdrName(name);
  return planned.find((m) => normalizeSdrName(m.name) === n)?.html ?? null;
}
