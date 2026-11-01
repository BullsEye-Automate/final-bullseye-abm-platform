// Correo de Alertas de Números. Se evalúa todos los días hábiles a las
// 8:00 de Chile (cron /api/cron/alertas-numeros) y se envía:
//   - siempre los lunes, como resumen semanal completo (por reemplazar, por
//     revisar, vigilar y los que salieron de alerta), y
//   - de martes a viernes SOLO si un número pasa a "Reemplazar" (rojo nuevo o
//     amarillo que empeora). Lo demás queda para el resumen del lunes y en la
//     página /analisis/salud-numeros.
// El estado de cada alerta vive en la tabla phone_health_alerts para no
// repetir el mismo aviso todos los días.
//
// Destinatarios: editables desde la página Salud de números
// (lib/mailRecipients.ts, clave "phone_health"). Remitente: PHONE_ALERTS_FROM, si no
// CELULAS_ALERTS_FROM. Ojo: mientras bullseye-abm.com no esté verificado en
// Resend, Resend solo entrega al dueño de su cuenta (ver lib/mailer.ts).
import { mailProvider, sendMail } from "@/lib/mailer";
import { getRecipients } from "@/lib/mailRecipients";
import { supabaseAdmin } from "@/lib/supabase";
import { dow, isBusinessDay, chileToday } from "@/lib/celulasSdr/calendar";
import { formatPct, LEVEL_LABEL, type NumberHealth } from "./engine";
import { buildPhoneHealthReport, saveCachedReport, type PhoneHealthReport } from "./server";

export function alertRecipients(): Promise<string[]> {
  return getRecipients("phone_health");
}

type StateRow = { allo_number: string; level: "red" | "yellow"; since: string };

export type AlertDiff = {
  newAlerts: NumberHealth[];   // aparecen o empeoran
  ongoing: NumberHealth[];     // siguen igual
  resolved: { number: string; name: string; client: string; wasLevel: string }[];
};

function isAlert(h: NumberHealth): h is NumberHealth & { level: "red" | "yellow" } {
  return h.level === "red" || h.level === "yellow";
}

export async function readAlertState(): Promise<Map<string, StateRow>> {
  const { data, error } = await supabaseAdmin().from("phone_health_alerts").select("allo_number, level, since");
  if (error) throw new Error(`phone_health_alerts: ${error.message}`);
  return new Map((data ?? []).map((r: any) => [r.allo_number, r as StateRow]));
}

export function diffAlerts(report: PhoneHealthReport, state: Map<string, StateRow>): AlertDiff {
  const newAlerts: NumberHealth[] = [];
  const ongoing: NumberHealth[] = [];
  const current = new Set<string>();
  for (const h of report.numbers) {
    if (!isAlert(h)) continue;
    current.add(h.number);
    const prev = state.get(h.number);
    const worsened = !prev || (prev.level === "yellow" && h.level === "red");
    (worsened ? newAlerts : ongoing).push(h);
  }
  const resolved: AlertDiff["resolved"] = [];
  for (const [num, row] of state) {
    if (current.has(num)) continue;
    const h = report.numbers.find((x) => x.number === num);
    // Un número sin volumen no se da por resuelto: simplemente no se evaluó.
    if (h && h.level === "low_volume") continue;
    resolved.push({ number: num, name: h?.name ?? num, client: h?.client ?? "", wasLevel: LEVEL_LABEL[row.level] });
  }
  return { newAlerts, ongoing, resolved };
}

async function saveAlertState(report: PhoneHealthReport, state: Map<string, StateRow>, diff: AlertDiff) {
  const db = supabaseAdmin();
  const rows = report.numbers.filter(isAlert).map((h) => {
    const prev = state.get(h.number);
    return {
      allo_number: h.number,
      level: h.level,
      since: prev && prev.level === h.level ? prev.since : report.today,
      last_seen: report.today,
      reasons: h.reasons,
      updated_at: new Date().toISOString(),
    };
  });
  if (rows.length) {
    const { error } = await db.from("phone_health_alerts").upsert(rows, { onConflict: "allo_number" });
    if (error) throw new Error(`phone_health_alerts upsert: ${error.message}`);
  }
  const resolvedNums = diff.resolved.map((r) => r.number);
  if (resolvedNums.length) {
    await db.from("phone_health_alerts").delete().in("allo_number", resolvedNums);
  }
}

// ─── HTML ───────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const COLORS = { red: "#C8414B", yellow: "#D9A21B", ink: "#251762", muted: "#54516E", teal: "#1FA39B", bg: "#F6F7FB" };

function row(h: NumberHealth, isNew: boolean): string {
  const color = h.level === "red" ? COLORS.red : COLORS.yellow;
  return `<tr>
<td style="padding:10px;border-bottom:1px solid #E3E4EE;vertical-align:top">
<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${color};color:#fff;font-size:12px;font-weight:700">${LEVEL_LABEL[h.level]}</span>
${isNew ? `<span style="display:inline-block;margin-left:4px;padding:2px 8px;border-radius:10px;background:${COLORS.ink};color:#fff;font-size:12px">Nueva</span>` : ""}
</td>
<td style="padding:10px;border-bottom:1px solid #E3E4EE;vertical-align:top"><b>${esc(h.name)}</b><br><span style="color:${COLORS.muted};font-size:12px">${esc(h.client)} · ${esc(h.country)} · ${esc(h.number)}</span></td>
<td style="padding:10px;border-bottom:1px solid #E3E4EE;vertical-align:top;text-align:right;white-space:nowrap"><b>${formatPct(h.rate7)}</b><br><span style="color:${COLORS.muted};font-size:12px">base ${formatPct(h.rateBase)} · ${h.dials7} llam.</span></td>
<td style="padding:10px;border-bottom:1px solid #E3E4EE;vertical-align:top;font-size:13px">${h.reasons.map(esc).join("<br>")}<br><b style="color:${COLORS.ink}">→ ${esc(h.action)}</b></td>
</tr>`;
}

export function buildAlertEmail(report: PhoneHealthReport, diff: AlertDiff, appUrl: string): { subject: string; html: string } {
  const reds = report.counts.red;
  const yellows = report.counts.yellow;
  const n = diff.newAlerts.length;
  const subject =
    reds + yellows === 0
      ? `Salud de números: todo en orden (${report.today})`
      : `Salud de números: ${reds} por reemplazar, ${yellows} por revisar${n ? ` · ${n} nueva${n > 1 ? "s" : ""}` : ""}`;

  const alertRows = [...diff.newAlerts.map((h) => row(h, true)), ...diff.ongoing.map((h) => row(h, false))].join("");
  const resolvedHtml = diff.resolved.length
    ? `<h3 style="font-size:15px;color:${COLORS.teal};margin:24px 0 8px">Salieron de alerta</h3><p style="font-size:13px;color:${COLORS.muted};margin:0">${diff.resolved
        .map((r) => `${esc(r.name)} (${esc(r.client)}, estaba en “${r.wasLevel}”)`)
        .join(" · ")}</p>`
    : "";
  const watch = report.numbers.filter((h) => h.level === "watch");
  const watchHtml = watch.length
    ? `<h3 style="font-size:15px;color:${COLORS.ink};margin:24px 0 8px">Vigilar</h3><p style="font-size:13px;color:${COLORS.muted};margin:0">${watch
        .map((h) => `${esc(h.name)}: ${esc(h.reasons[0] ?? "")}`)
        .join("<br>")}</p>`
    : "";

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;background:${COLORS.bg};padding:24px">
<div style="max-width:760px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<p style="margin:0;color:${COLORS.teal};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase">BullsEye · Salud de números</p>
<h2 style="margin:6px 0 4px;color:${COLORS.ink};font-size:22px">${reds + yellows === 0 ? "Todos los números están dentro de lo normal" : `${reds} por reemplazar y ${yellows} por revisar`}</h2>
<p style="margin:0 0 18px;color:${COLORS.muted};font-size:13px">Últimos 7 días (${report.windows.current[0]} a ${report.windows.current[1]}) comparados con el promedio de las 4 semanas anteriores. Métrica: % de llamadas que contesta una persona.</p>
${report.dataWarning ? `<p style="margin:0 0 18px;padding:10px 12px;background:#FFF6E0;border-radius:8px;color:${COLORS.ink};font-size:12px">${esc(report.dataWarning)}</p>` : ""}
${
  alertRows
    ? `<table style="width:100%;border-collapse:collapse;font-size:14px;color:${COLORS.ink}"><tr style="background:${COLORS.bg}"><th style="padding:8px;text-align:left">Nivel</th><th style="padding:8px;text-align:left">Número</th><th style="padding:8px;text-align:right">Contesta</th><th style="padding:8px;text-align:left">Motivo y acción</th></tr>${alertRows}</table>`
    : ""
}
${resolvedHtml}${watchHtml}
<p style="margin:24px 0 0;font-size:13px;color:${COLORS.muted}">Sanos: ${report.counts.ok} · Vigilar: ${report.counts.watch} · Sin volumen suficiente: ${report.counts.low_volume}</p>
<p style="margin:16px 0 0"><a href="${appUrl}/analisis/salud-numeros" style="display:inline-block;background:${COLORS.ink};color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-size:14px">Ver en el portal</a></p>
</div></div>`;
  return { subject, html };
}

// ─── Envío ──────────────────────────────────────────────────────────────────
export type AlertRunResult = {
  today: string;
  sent: boolean;
  reason: string;
  to: string[];
  counts: PhoneHealthReport["counts"];
  newAlerts: number;
  resolved: number;
  dataWarning: string | null;
};

// cron = true: guarda el estado y aplica la regla de envío (nuevas / lunes).
// cron = false (botón "Enviarme el correo ahora"): envía siempre y no toca el estado.
export async function runPhoneAlerts(opts: { cron: boolean; to?: string[]; today?: string } = { cron: true }): Promise<AlertRunResult> {
  const today = opts.today ?? chileToday();
  const report = await buildPhoneHealthReport(today);
  // El cron deja el reporte del día en caché para la página y la franja.
  if (opts.cron) await saveCachedReport(report);
  const state = await readAlertState();
  const diff = diffAlerts(report, state);
  const to = opts.to?.length ? opts.to : await alertRecipients();
  const result = (sent: boolean, reason: string): AlertRunResult => ({
    today, sent, reason, to, counts: report.counts, newAlerts: diff.newAlerts.length, resolved: diff.resolved.length, dataWarning: report.dataWarning,
  });

  if (report.dataWarning && report.dataWarning.includes("suspendidas")) {
    return result(false, report.dataWarning);
  }

  let shouldSend = true;
  let reason = "Envío manual";
  if (opts.cron) {
    if (!isBusinessDay(today)) return result(false, "No es día hábil");
    const monday = dow(today) === 1;
    // Martes a viernes: solo urgencias (un número que pasa a "Reemplazar").
    const newRed = diff.newAlerts.some((h) => h.level === "red");
    shouldSend = monday || newRed;
    reason = monday ? "Resumen semanal (lunes)" : newRed ? "Hay números nuevos por reemplazar" : "Sin urgencias (queda para el resumen del lunes)";
  }
  if (!shouldSend) {
    if (opts.cron) await saveAlertState(report, state, diff);
    return result(false, reason);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://portal.bullseye-abm.com";
  const { subject, html } = buildAlertEmail(report, diff, appUrl);
  const from =
    process.env.PHONE_ALERTS_FROM ||
    process.env.CELULAS_ALERTS_FROM ||
    (mailProvider() === "resend" ? "onboarding@resend.dev" : "ihincapie@bullseye-abm.com");
  await sendMail({ from, fromName: "BullsEye · Salud de números", to, subject, html });
  // El estado se guarda solo después de un envío exitoso: si el correo
  // falla, las alertas nuevas se vuelven a avisar en la próxima ejecución.
  if (opts.cron) await saveAlertState(report, state, diff);
  return result(true, reason);
}
