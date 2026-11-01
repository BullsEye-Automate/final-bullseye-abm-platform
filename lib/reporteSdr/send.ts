// Envío del Reporte SDR diario (lunes a viernes hábiles, 13:00 y 18:30 de
// Chile). Destinatarios: editables desde Análisis → SDR → "Reporte SDR por
// correo" (lib/mailRecipients.ts, clave "reporte_sdr"; por defecto Ingri,
// José Antonio y Adolfo). Remitente: REPORTE_SDR_FROM, si no CELULAS_ALERTS_FROM
// (el mismo de las alertas de Células SDR), si no onboarding@resend.dev.
import { mailProvider, sendMail } from "@/lib/mailer";
import { getRecipients } from "@/lib/mailRecipients";
import { supabaseAdmin } from "@/lib/supabase";
import { buildDailySdrReport, formatLongDate, pct, shortName, type DailySdrReport } from "./data";
import { renderReportPng } from "./image";

export function reportRecipients(): Promise<string[]> {
  return getRecipients("reporte_sdr");
}

function reportFrom(): string {
  return (
    process.env.REPORTE_SDR_FROM ||
    process.env.CELULAS_ALERTS_FROM ||
    (mailProvider() === "resend" ? "onboarding@resend.dev" : "ihincapie@bullseye-abm.com")
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function emailHtml(r: DailySdrReport, filename: string): string {
  const T = r.totals;
  const top = r.rows.slice(0, 3).map((x) => `${esc(shortName(x.name))} (${x.calls})`).join(", ");
  return `<div style="font-family:Arial,sans-serif;color:#1c1640;font-size:14px;line-height:1.5">
<p><b>Reporte SDR · ${esc(formatLongDate(r.day))} · corte ${esc(r.cutLabel)} hrs</b></p>
<p>${T.calls} llamadas · ${T.contacts} contactos gestionados · ${T.connected} conectadas (${pct(T.connected, T.calls)}) · <b>${T.meetings} reuniones agendadas</b></p>
${top ? `<p>Más llamadas: ${top}.</p>` : ""}
<p>El detalle por SDR y las reuniones del día van en la imagen adjunta (<i>${esc(filename)}</i>), lista para reenviar por WhatsApp.</p>
<p style="color:#8a84ab;font-size:12px">Correo automático del portal BullsEye · Fuente: Análisis → SDR (Allo + planilla de reuniones).</p>
</div>`;
}

export async function buildReportPng(cutLabel: string): Promise<{ report: DailySdrReport; png: Buffer; filename: string }> {
  const report = await buildDailySdrReport({ cutLabel });
  const png = await renderReportPng(report);
  const filename = `reporte_sdr_${report.day}_${cutLabel.replace(":", "")}.png`;
  return { report, png, filename };
}

export async function sendDailySdrReport(cutLabel: string, opts: { to?: string[] } = {}) {
  const { report, png, filename } = await buildReportPng(cutLabel);
  const to = opts.to?.length ? opts.to : await reportRecipients();
  const subject = `Reporte SDR · ${formatLongDate(report.day)} · corte ${cutLabel}`;
  const { id } = await sendMail({
    from: reportFrom(),
    fromName: "BullsEye · Reporte SDR",
    to,
    subject,
    html: emailHtml(report, filename),
    attachments: [{ filename, content: png, contentType: "image/png" }],
  });
  return { id, to, subject, filename, day: report.day, totals: report.totals, rows: report.rows.length, bytes: png.length };
}

// ─── Registro de envíos y aviso de falla ────────────────────────────────────
// El cron guarda qué corte se envió cada día (en allo_response_cache, 3 días)
// para que el reintento de una hora después sepa si debe volver a intentarlo.

const sentKey = (day: string, slot: string) => `reporte_sdr_sent:${day}:${slot}`;

export async function markReportSent(day: string, slot: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("allo_response_cache")
    .upsert(
      { cache_key: sentKey(day, slot), response: { sentAt: new Date().toISOString() }, expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString() },
      { onConflict: "cache_key" }
    );
  if (error) console.error("No se pudo registrar el envío del Reporte SDR:", error.message);
}

export async function wasReportSent(day: string, slot: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin().from("allo_response_cache").select("cache_key").eq("cache_key", sentKey(day, slot)).maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

// Si el envío y su reintento fallan, avisa a los destinatarios con el motivo,
// para que la falla no pase inadvertida (y se pueda usar "Enviar ahora").
export async function sendReportFailureNotice(cutLabel: string, reason: string): Promise<void> {
  const to = await reportRecipients();
  await sendMail({
    from: reportFrom(),
    fromName: "BullsEye · Reporte SDR",
    to,
    subject: `No se pudo generar el Reporte SDR · corte ${cutLabel}`,
    html: `<div style="font-family:Arial,sans-serif;color:#1c1640;font-size:14px;line-height:1.5">
<p>El Reporte SDR del corte <b>${esc(cutLabel)}</b> no se pudo generar, ni siquiera en el reintento automático.</p>
<p style="color:#54516e">Motivo: ${esc(reason)}</p>
<p>Puedes enviarlo a mano desde Análisis → SDR → “Reporte SDR por correo” → <b>Enviar ahora</b>.</p>
</div>`,
  });
}
