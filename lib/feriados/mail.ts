// Correo diario de la Alerta de feriados (lunes a viernes, 7:30 de Chile,
// cron /api/cron/alerta-feriados). Contenido: estado de hoy por país,
// reuniones agendadas en un feriado (planilla de reuniones + HubSpot),
// próximos feriados en días hábiles y las fuentes oficiales.
//
// Destinatarios: editables desde Análisis → Alerta de feriados
// (lib/mailRecipients.ts, clave "feriados"; por defecto Ingri, Vanessa y
// Nicolle). Remitente: FERIADOS_ALERTS_FROM, si no CELULAS_ALERTS_FROM
// (alertas@notificaciones.bullseye-abm.com). Respuestas: FERIADOS_ALERTS_REPLY_TO
// (una o varias separadas por coma), si no amadriz@ — la casilla de alertas
// no se revisa.
import { mailProvider, sendMail } from "@/lib/mailer";
import { getRecipients } from "@/lib/mailRecipients";
import { supabaseAdmin } from "@/lib/supabase";
import { COUNTRIES, COUNTRY_ORDER, KIND_LABEL, type Holiday, type HolidayKind } from "./calendar";
import { buildHolidayReport, weekday, type HolidayReport, type MeetingFlag } from "./report";

export function holidayRecipients(): Promise<string[]> {
  return getRecipients("feriados");
}

function alertFrom(): string {
  return (
    process.env.FERIADOS_ALERTS_FROM ||
    process.env.CELULAS_ALERTS_FROM ||
    (mailProvider() === "resend" ? "onboarding@resend.dev" : "ihincapie@bullseye-abm.com")
  );
}

function alertReplyTo(): string[] {
  return (process.env.FERIADOS_ALERTS_REPLY_TO || "amadriz@bullseye-abm.com")
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const C = {
  ink: "#251762",
  text: "#1c1640",
  muted: "#6b6789",
  line: "#E3E4EE",
  red: "#B3261E",
  redBg: "#FBEAEA",
  amber: "#8A5A00",
  amberBg: "#FDF3DC",
  green: "#1B6E3A",
  greenBg: "#E7F5EC",
  grayBg: "#F3F3F7",
};

const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const dd = (day: string) => Number(day.slice(8, 10));
const mm = (day: string) => Number(day.slice(5, 7)) - 1;
export const longDay = (day: string) => `${DAYS[weekday(day)]} ${dd(day)} de ${MONTHS[mm(day)]}`;
export const shortDay = (day: string) => `${DAYS_SHORT[weekday(day)]} ${dd(day)} ${MONTHS_SHORT[mm(day)]}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const KIND_STYLE: Record<HolidayKind, { fg: string; bg: string }> = {
  national: { fg: C.red, bg: C.redBg },
  regional: { fg: C.amber, bg: C.amberBg },
  low: { fg: C.amber, bg: C.amberBg },
};

const pill = (text: string, fg: string, bg: string) =>
  `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${bg};color:${fg};font-size:12px;font-weight:600;white-space:nowrap">${esc(text)}</span>`;

const holidayLabel = (x: Holiday) => (x.kind === "regional" && x.regions ? `${x.name} (solo ${x.regions})` : x.name);

// ─── Asunto ─────────────────────────────────────────────────────────────────

export function buildSubject(r: HolidayReport): string {
  const off = r.todayStatus.filter((s) => s.holidays.some((h) => h.kind === "national")).map((s) => COUNTRIES[s.country].name);
  const conflicts = r.flags.filter((f) => f.level === "conflict").length;
  const head = off.length ? `hoy feriado en ${off.join(", ")}` : "hoy se llama normal en los 5 países";
  const tail = conflicts ? ` · ${conflicts} reunión${conflicts === 1 ? "" : "es"} en feriado` : "";
  return `Feriados · ${shortDay(r.today)}: ${head}${tail}`;
}

// ─── Secciones ──────────────────────────────────────────────────────────────

function todaySection(r: HolidayReport): string {
  const withHoliday = r.todayStatus.filter((s) => s.holidays.length);
  if (!withHoliday.length) {
    return `<table style="width:100%;border-collapse:collapse;margin:0 0 18px"><tr><td style="background:${C.greenBg};border-radius:8px;padding:12px 14px;color:${C.green};font-weight:600">✔ Hoy se llama normal en los 5 países</td></tr></table>`;
  }
  const rows = COUNTRY_ORDER.map((code) => {
    const s = r.todayStatus.find((x) => x.country === code)!;
    const top = s.holidays[0];
    const status = top ? pill(KIND_LABEL[top.kind], KIND_STYLE[top.kind].fg, KIND_STYLE[top.kind].bg) : pill("Normal", C.green, C.greenBg);
    const detail = top ? esc(holidayLabel(top)) : "Se llama normal";
    return `<tr><td style="padding:7px 8px;border-bottom:1px solid ${C.line};width:110px"><b>${esc(COUNTRIES[code].name)}</b></td><td style="padding:7px 8px;border-bottom:1px solid ${C.line};width:130px">${status}</td><td style="padding:7px 8px;border-bottom:1px solid ${C.line};color:${C.muted};font-size:13px">${detail}</td></tr>`;
  }).join("");
  return `<p style="margin:0 0 6px;font-weight:700">Hoy</p><table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 18px">${rows}</table>`;
}

const LEVEL_META: Record<MeetingFlag["level"], { title: string; fg: string; bg: string; hint: string }> = {
  conflict: { title: "Reuniones en feriado", fg: C.red, bg: C.redBg, hint: "Caen en un feriado del país de la empresa: reagendar." },
  review: { title: "Reuniones a revisar", fg: C.amber, bg: C.amberBg, hint: "Feriado regional o día de baja actividad: confirmar con el contacto." },
  unverified: { title: "Reuniones sin país", fg: C.muted, bg: C.grayBg, hint: "Caen en un feriado de algún país, pero no tienen país o empresa: completar el dato." },
};

const MAX_ROWS_PER_LEVEL = 15;

function meetingsSection(r: HolidayReport, appUrl: string): string {
  const total = r.checked.sheet + r.checked.hubspot;
  if (!r.flags.length) {
    return `<p style="margin:0 0 6px;font-weight:700">Reuniones agendadas en feriado</p>
<p style="margin:0 0 18px">Ninguna. ✔ <span style="color:${C.muted};font-size:12px">Revisé ${total} reuniones de los próximos días (${r.checked.sheet} de la planilla y ${r.checked.hubspot} de HubSpot).</span></p>`;
  }
  const blocks = (["conflict", "review", "unverified"] as const).map((level) => {
    const list = r.flags.filter((f) => f.level === level);
    if (!list.length) return "";
    const meta = LEVEL_META[level];
    const rows = list.slice(0, MAX_ROWS_PER_LEVEL).map((f) => {
      const company = f.url ? `<a href="${esc(f.url)}" style="color:${C.ink}">${esc(f.company)}</a>` : esc(f.company);
      return `<tr>
<td style="padding:7px 8px;border-bottom:1px solid ${C.line};vertical-align:top;white-space:nowrap">${esc(shortDay(f.date))}${f.time ? `<br><span style="color:${C.muted};font-size:12px">${esc(f.time)}</span>` : ""}</td>
<td style="padding:7px 8px;border-bottom:1px solid ${C.line};vertical-align:top"><b>${company}</b><br><span style="color:${C.muted};font-size:12px">${esc(f.country ?? "Sin país")} · ${esc(f.title)} · ${esc(f.source)}</span></td>
<td style="padding:7px 8px;border-bottom:1px solid ${C.line};vertical-align:top;font-size:13px">${esc(f.who)}</td>
<td style="padding:7px 8px;border-bottom:1px solid ${C.line};vertical-align:top;font-size:13px">${esc(f.reason)}</td>
</tr>`;
    }).join("");
    const more = list.length > MAX_ROWS_PER_LEVEL
      ? `<p style="margin:4px 0 0;font-size:12px;color:${C.muted}">Y ${list.length - MAX_ROWS_PER_LEVEL} más: <a href="${appUrl}/analisis/feriados" style="color:${C.ink}">ver todas en el portal</a>.</p>`
      : "";
    return `<p style="margin:0 0 4px">${pill(`${meta.title} · ${list.length}`, meta.fg, meta.bg)}</p>
<p style="margin:0 0 6px;font-size:12px;color:${C.muted}">${meta.hint}</p>
<table style="width:100%;border-collapse:collapse;font-size:13px;margin:0 0 14px">
<tr style="background:#F6F7FB"><th style="text-align:left;padding:6px 8px">Fecha</th><th style="text-align:left;padding:6px 8px">Empresa</th><th style="text-align:left;padding:6px 8px">Responsable</th><th style="text-align:left;padding:6px 8px">Motivo</th></tr>
${rows}</table>${more}`;
  }).join("");
  return `<p style="margin:0 0 8px;font-weight:700">Reuniones agendadas en feriado</p>${blocks}`;
}

function upcomingSection(r: HolidayReport): string {
  if (!r.upcoming.length) {
    return `<p style="margin:0 0 6px;font-weight:700">Próximos feriados en días hábiles</p><p style="margin:0 0 18px">Ninguno en las próximas 3 semanas.</p>`;
  }
  const rows = r.upcoming.flatMap(({ date, holidays }) =>
    holidays.map((x) => `<tr>
<td style="padding:7px 8px;border-bottom:1px solid ${C.line};white-space:nowrap">${esc(cap(shortDay(date)))}</td>
<td style="padding:7px 8px;border-bottom:1px solid ${C.line}">${esc(COUNTRIES[x.country].name)}</td>
<td style="padding:7px 8px;border-bottom:1px solid ${C.line}">${esc(holidayLabel(x))}<br><span style="color:${C.muted};font-size:12px">${esc(x.legal)}</span></td>
<td style="padding:7px 8px;border-bottom:1px solid ${C.line}">${pill(KIND_LABEL[x.kind], KIND_STYLE[x.kind].fg, KIND_STYLE[x.kind].bg)}</td>
</tr>`)
  ).join("");
  return `<p style="margin:0 0 6px;font-weight:700">Próximos feriados en días hábiles (3 semanas)</p>
<table style="width:100%;border-collapse:collapse;font-size:13px;margin:0 0 8px">
<tr style="background:#F6F7FB"><th style="text-align:left;padding:6px 8px">Fecha</th><th style="text-align:left;padding:6px 8px">País</th><th style="text-align:left;padding:6px 8px">Motivo</th><th style="text-align:left;padding:6px 8px">Impacto</th></tr>
${rows}</table>`;
}

function weekendNote(r: HolidayReport): string {
  if (!r.weekend.length) return "";
  const items = r.weekend
    .flatMap(({ date, holidays }) => holidays.filter((x) => x.kind !== "low").map((x) => `${COUNTRIES[x.country].name} ${shortDay(date)} (${x.name})`))
    .join("; ");
  return items ? `<p style="margin:0 0 18px;font-size:12px;color:${C.muted}">En fin de semana, sin impacto: ${esc(items)}.</p>` : "";
}

function sourcesFooter(): string {
  const links = COUNTRY_ORDER.map(
    (c) => `${esc(COUNTRIES[c].name)}: <a href="${esc(COUNTRIES[c].sourceUrl)}" style="color:${C.muted}">${esc(COUNTRIES[c].source)}</a>`
  ).join(" · ");
  return `<p style="margin:0 0 4px;font-size:12px;color:${C.muted}">Fuentes oficiales: ${links}.</p>`;
}

export function buildHolidayEmail(r: HolidayReport, appUrl: string): { subject: string; html: string } {
  const warnings = r.warnings.length
    ? `<p style="margin:0 0 18px;padding:10px 12px;background:${C.amberBg};color:${C.amber};border-radius:8px;font-size:13px">⚠ ${r.warnings.map(esc).join("<br>⚠ ")}</p>`
    : "";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:${C.text};max-width:640px;font-size:14px;line-height:1.5">
<p style="margin:0 0 4px;font-size:12px;color:${C.muted}">Alerta diaria de feriados · Chile, México, Colombia, Perú y Argentina</p>
<h2 style="margin:0 0 14px;font-size:20px;color:${C.ink}">${esc(cap(longDay(r.today)))}</h2>
${todaySection(r)}
${meetingsSection(r, appUrl)}
${upcomingSection(r)}
${weekendNote(r)}
${warnings}
<p style="margin:0 0 18px"><a href="${appUrl}/analisis/feriados" style="display:inline-block;background:${C.ink};color:#fff;padding:9px 14px;border-radius:8px;text-decoration:none;font-size:13px">Ver en el portal</a></p>
${sourcesFooter()}
<p style="margin:0;font-size:12px;color:${C.muted}">Correo automático del portal BullsEye, de lunes a viernes a las 7:30 de Chile.</p>
</div>`;
  return { subject: buildSubject(r), html };
}

// ─── Envío ──────────────────────────────────────────────────────────────────

export async function sendHolidayAlert(opts: { to?: string[] } = {}) {
  const report = await buildHolidayReport();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://portal.bullseye-abm.com";
  const { subject, html } = buildHolidayEmail(report, appUrl);
  const to = opts.to?.length ? opts.to : await holidayRecipients();
  const { id } = await sendMail({ from: alertFrom(), fromName: "BullsEye · Alerta de feriados", to, replyTo: alertReplyTo(), subject, html });
  return { id, to, subject, day: report.today, flags: report.flags.length, warnings: report.warnings };
}

// Registro de envío del día (allo_response_cache, 3 días) para el reintento.
const sentKey = (day: string) => `feriados_alert_sent:${day}`;

export async function markAlertSent(day: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("allo_response_cache")
    .upsert(
      { cache_key: sentKey(day), response: { sentAt: new Date().toISOString() }, expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString() },
      { onConflict: "cache_key" }
    );
  if (error) console.error("No se pudo registrar el envío de la Alerta de feriados:", error.message);
}

export async function wasAlertSent(day: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin().from("allo_response_cache").select("cache_key").eq("cache_key", sentKey(day)).maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}
