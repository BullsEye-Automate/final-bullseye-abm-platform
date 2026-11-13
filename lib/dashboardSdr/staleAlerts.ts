import { supabaseAdmin } from "@/lib/supabase";
import { sendMail } from "@/lib/mailer";
import { normalizeSdrName, resolveSdrKey } from "@/lib/sdrAnalytics";
import { readMaster } from "@/lib/celulasSdr/sheets";
import { addDays, chileToday, dow, isBusinessDay } from "@/lib/celulasSdr/calendar";
import { CC_ALWAYS, TEST_RECIPIENT, leaderEmail } from "@/lib/celulasSdr/server/alertsMail";
import { readMasterPeople, resolveSdr } from "@/lib/respuestasLemlist/directory";
import { buildAll, NO_SDR_KEY } from "./server";
import { STALE_BUSINESS_DAYS, staleDays } from "./stale";
import type { SdrCompany, SdrSlice } from "./types";

// Alerta de cuentas estancadas (nov-2026, pedido de BullsEye): empresas que
// siguen en "Asignada" 15 días hábiles o más (regla en ./stale.ts). Dos
// correos, una vez por semana (primer día hábil, ~9:00 de Chile):
//  - a cada SDR: su lista de cuentas estancadas por cliente,
//  - a cada líder de célula: resumen por SDR de su célula + las más antiguas,
//    con copia a CC_ALWAYS. Los SDR sin célula identificada van a CC_ALWAYS.
// Datos: los mismos del Dashboard SDR (informes de Pulso ABM).
// Modo STALE_ALERTS_MODE: "test" por defecto (todo a TEST_RECIPIENT con los
// destinatarios reales en el cuerpo); "activo" = envío real.
// Remitente: STALE_ALERTS_FROM → CELULAS_ALERTS_FROM.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://portal.bullseye-abm.com";
const MAX_ROWS_SDR = 150;
const MAX_ROWS_LEADER = 40;

type StaleRow = SdrCompany & { days: number; sdr: string };
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
const dmy = (d: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const TH = 'style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;font-size:12px;color:#555"';
const TD = 'style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px"';
const TDN = 'style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;text-align:right"';

function staleOf(s: SdrSlice, today: string): StaleRow[] {
  const out: StaleRow[] = [];
  for (const c of s.companies) {
    const days = staleDays(c, today);
    if (days !== null && days >= STALE_BUSINESS_DAYS) out.push({ ...c, days, sdr: s.name });
  }
  return out.sort((a, b) => b.days - a.days || a.c.localeCompare(b.c) || a.n.localeCompare(b.n));
}

function byClient(rows: StaleRow[]): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.c, (m.get(r.c) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function rowsTable(rows: StaleRow[], showSdr: boolean, max: number): string {
  const body = rows.slice(0, max).map((r) =>
    `<tr><td ${TD}><b>${esc(r.n)}</b>${r.pais ? `<br><span style="color:#777">${esc(r.pais)}</span>` : ""}</td><td ${TD}>${esc(r.c)}</td>${showSdr ? `<td ${TD}>${esc(r.sdr)}</td>` : ""}<td ${TD}>${dmy(r.asg)}</td><td ${TDN}><b>${r.days}</b></td><td ${TDN}>${r.nct}</td></tr>`
  ).join("");
  const more = rows.length > max ? `<p style="font-size:12px;color:#777">… y ${rows.length - max} más (ver el dashboard).</p>` : "";
  return `<table style="border-collapse:collapse;width:100%"><tr><th ${TH}>Empresa</th><th ${TH}>Cliente</th>${showSdr ? `<th ${TH}>SDR</th>` : ""}<th ${TH}>Asignada el</th><th ${TH}>Días hábiles</th><th ${TH}>Contactos</th></tr>${body}</table>${more}`;
}

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
  const { slices } = await buildAll(today);
  const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_MEETINGS_ID no configurado");
  const [master, people] = await Promise.all([readMaster(spreadsheetId, []), readMasterPeople()]);
  const cellOf = new Map<string, string>(); // clave SDR → líder
  for (const c of master.cells) {
    for (const n of [c.leader, ...c.members]) cellOf.set(resolveSdrKey(n), c.leader);
  }

  const testNote = (to: string[], cc: string[]) =>
    live ? "" : `<div style="background:#FAEEDA;border:1px solid #E8C98F;padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:12px">Modo prueba: en envío real este correo iría a <b>${esc(to.join(", ") || "—")}</b>${cc.length ? ` con copia a ${esc(cc.join(", "))}` : ""}.</div>`;

  const staleBySdr = new Map<string, StaleRow[]>();
  for (const s of slices.values()) {
    if (s.key === NO_SDR_KEY) continue;
    const rows = staleOf(s, today);
    if (rows.length) staleBySdr.set(s.key, rows);
  }
  const unassigned = slices.get(NO_SDR_KEY);
  const unassignedStale = unassigned ? staleOf(unassigned, today) : [];
  if (unassignedStale.length) notes.push(`${unassignedStale.length} cuentas estancadas sin SDR asignado en HubSpot (van en el correo de copia).`);

  const mails: Planned[] = [];
  // 1) Cada SDR
  for (const [key, rows] of staleBySdr) {
    const name = rows[0].sdr;
    const r = resolveSdr(people, name);
    if (!r.ok) { notes.push(`${name}: sin correo de SDR (${r.reason}). Va solo en el resumen de su líder.`); continue; }
    const to = [r.person.email!];
    const clients = byClient(rows).map(([c, n]) => `${esc(c)} (${n})`).join(", ");
    const inner = rowsTable(rows, false, MAX_ROWS_SDR);
    mails.push({
      kind: "sdr", name, to, cc: [], count: rows.length,
      subject: `Tienes ${rows.length} cuenta${rows.length === 1 ? "" : "s"} sin gestionar hace ${STALE_BUSINESS_DAYS}+ días hábiles`,
      html: wrap(
        `Hola ${name.split(" ")[0]}: cuentas estancadas`,
        `Estas empresas siguen en <b>Asignada</b> hace ${STALE_BUSINESS_DAYS} días hábiles o más: ${clients}. Gestiónalas o actualiza su status en HubSpot (si no califican, márcalas como corresponde según La Biblia).`,
        inner, `${APP_URL}/sdr/dashboard?sdr=${encodeURIComponent(key)}&estancadas=1`, testNote(to, [])
      ),
    });
  }

  // 2) Cada líder: su célula
  const byLeader = new Map<string, string[]>(); // líder → claves SDR
  const noCell: string[] = [];
  for (const key of staleBySdr.keys()) {
    const leader = cellOf.get(key);
    const email = leader ? leaderEmail(leader) : null;
    if (!leader || !email) { noCell.push(key); continue; }
    byLeader.set(leader, [...(byLeader.get(leader) ?? []), key]);
  }
  const summary = (keys: string[]) => {
    const rows = keys.flatMap((k) => staleBySdr.get(k)!).sort((a, b) => b.days - a.days);
    const perSdr = keys
      .map((k) => { const r = staleBySdr.get(k)!; return { name: r[0].sdr, n: r.length, max: r[0].days, clients: byClient(r) }; })
      .sort((a, b) => b.n - a.n);
    const table = `<table style="border-collapse:collapse;width:100%;margin-bottom:14px"><tr><th ${TH}>SDR</th><th ${TH}>Estancadas</th><th ${TH}>Más antigua (días hábiles)</th><th ${TH}>Por cliente</th></tr>${perSdr
      .map((p) => `<tr><td ${TD}><b>${esc(p.name)}</b></td><td ${TDN}><b>${p.n}</b></td><td ${TDN}>${p.max}</td><td ${TD}>${p.clients.map(([c, n]) => `${esc(c)} ${n}`).join(" · ")}</td></tr>`)
      .join("")}</table>`;
    return { rows, table };
  };
  for (const [leader, keys] of byLeader) {
    const { rows, table } = summary(keys);
    const to = [leaderEmail(leader)!];
    const cc = CC_ALWAYS.filter((x) => !to.includes(x));
    mails.push({
      kind: "lider", name: leader, to, cc, count: rows.length,
      subject: `Tu célula tiene ${rows.length} cuenta${rows.length === 1 ? "" : "s"} estancada${rows.length === 1 ? "" : "s"} en Asignada`,
      html: wrap(
        `Cuentas estancadas de tu célula`,
        `Empresas en <b>Asignada</b> hace ${STALE_BUSINESS_DAYS} días hábiles o más, por SDR. Abajo, las ${Math.min(rows.length, MAX_ROWS_LEADER)} más antiguas.`,
        table + rowsTable(rows, true, MAX_ROWS_LEADER), `${APP_URL}/sdr/dashboard?estancadas=1`, testNote(to, cc)
      ),
    });
  }

  // 3) SDR sin célula identificada + cuentas sin SDR → CC_ALWAYS
  if (noCell.length || unassignedStale.length) {
    const { rows, table } = summary(noCell);
    const all = [...rows, ...unassignedStale.map((r) => ({ ...r, sdr: "Sin SDR asignado" }))].sort((a, b) => b.days - a.days);
    const to = [...CC_ALWAYS];
    mails.push({
      kind: "sin_celula", name: "Sin célula / sin SDR", to, cc: [], count: all.length,
      subject: `${all.length} cuentas estancadas de SDR sin célula o sin SDR asignado`,
      html: wrap(
        `Cuentas estancadas sin líder que las reciba`,
        `Estas cuentas llevan ${STALE_BUSINESS_DAYS}+ días hábiles en <b>Asignada</b> y su SDR no tiene célula (o líder con correo) en la Maestra, o la empresa no tiene SDR en HubSpot.`,
        (noCell.length ? table : "") + rowsTable(all, true, MAX_ROWS_LEADER), `${APP_URL}/sdr/dashboard?estancadas=1`, testNote(to, [])
      ),
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
      await sendMail({ from, fromName: "BullsEye · Cuentas estancadas", to, cc, subject: live ? m.subject : `[Prueba] ${m.subject}`, html: m.html });
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
