// Envío del Reporte SDR diario (lunes a viernes hábiles, 13:00 y 18:30 de
// Chile). Destinatario por defecto: Ingri Hincapié (confirmado con BullsEye).
// Mientras bullseye-abm.com no esté verificado en Resend, la cuenta (de Ingri)
// solo puede enviar a ihincapie@. Una vez verificado, se pueden sumar más
// destinatarios sin deploy de código con REPORTE_SDR_TO (lista separada por
// comas, ej. "ihincapie@bullseye-abm.com,amadriz@bullseye-abm.com"). Remitente: REPORTE_SDR_FROM, si no CELULAS_ALERTS_FROM
// (el mismo de las alertas de Células SDR), si no onboarding@resend.dev.
import { mailProvider, sendMail } from "@/lib/mailer";
import { buildDailySdrReport, formatLongDate, pct, shortName, type DailySdrReport } from "./data";
import { renderReportPng } from "./image";

const DEFAULT_TO = ["ihincapie@bullseye-abm.com"];

export function reportRecipients(): string[] {
  const env = process.env.REPORTE_SDR_TO;
  const list = env ? env.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_TO;
  return list.length ? list : DEFAULT_TO;
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
  const to = opts.to?.length ? opts.to : reportRecipients();
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
