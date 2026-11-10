import { mailProvider, sendMail } from "@/lib/mailer";
import { CATEGORY_LABEL, type Category } from "./classify";

// Respuestas Lemlist → SDR: correos al SDR, alerta al KAM y resumen en modo sombra.

const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fromAddress = () =>
  process.env.RESPUESTAS_LEMLIST_FROM || process.env.CELULAS_ALERTS_FROM || (mailProvider() === "resend" ? "onboarding@resend.dev" : "ihincapie@bullseye-abm.com");

export type ReplyMailData = {
  clientName: string;
  leadName: string;
  leadEmail: string;
  companyName: string;
  channel: "email" | "linkedin";
  campaignName: string;
  category: Category;
  summary: string;
  replyText: string;
  hubspotUrl: string | null;
  repliedAt?: string | null;
  sdrName?: string | null;
  reason?: string | null;
};

function card(d: ReplyMailData): string {
  const row = (k: string, v: string) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap">${k}</td><td style="padding:4px 0">${v}</td></tr>`;
  return `<table style="border-collapse:collapse;font-size:14px">
${row("Cliente", esc(d.clientName))}
${row("Contacto", `${esc(d.leadName || d.leadEmail)} · ${esc(d.leadEmail)}`)}
${row("Empresa", esc(d.companyName || "—"))}
${row("Canal", d.channel === "email" ? "Email" : "LinkedIn")}
${d.repliedAt ? row("Respondió", esc(new Date(d.repliedAt).toLocaleString("es-CL", { timeZone: "America/Santiago", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }))) : ""}
${row("Campaña", esc(d.campaignName))}
${row("Interés", `<b>${esc(CATEGORY_LABEL[d.category])}</b>`)}
${row("Resumen", esc(d.summary))}
${d.sdrName ? row("SDR asignado", esc(d.sdrName)) : ""}
${d.reason ? row("Motivo", esc(d.reason)) : ""}
</table>
<div style="margin:12px 0;padding:12px;border-left:3px solid #62E0D8;background:#f6f7fb;white-space:pre-wrap;font-size:13px">${esc(d.replyText.slice(0, 1500) || "(sin texto)")}</div>
${d.hubspotUrl ? `<p><a href="${esc(d.hubspotUrl)}" style="color:#251762;font-weight:600">Abrir el contacto en HubSpot</a></p>` : ""}`;
}

const wrap = (title: string, body: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;max-width:640px"><h2 style="color:#251762;font-size:18px">${esc(title)}</h2>${body}<p style="color:#9ca3af;font-size:12px;margin-top:24px">Automatización de respuestas Lemlist · BullsEye</p></div>`;

// Al SDR: respondió con interés, llamar
export async function sendSdrMail(to: string, d: ReplyMailData, cc: string[] = []) {
  return sendMail({
    from: fromAddress(),
    fromName: "BullsEye · Respuestas Lemlist",
    to: [to],
    cc,
    subject: `🔥 ${d.leadName || d.leadEmail} (${d.companyName || d.clientName}) respondió: ${CATEGORY_LABEL[d.category]}`,
    html: wrap("Respuesta para llamar (Hot Calling)", `<p>Te asignamos esta respuesta de <b>${esc(d.clientName)}</b>. El lead quedó pausado en Lemlist.</p>${card(d)}`),
  });
}

// Al KAM: respuesta sin SDR asignado / SDR inactivo / clasificación dudosa
export async function sendKamMail(to: string, d: ReplyMailData, kind: "sin_sdr" | "revision") {
  const title = kind === "sin_sdr" ? "Respuesta sin SDR asignado" : "Respuesta para revisar";
  const intro = kind === "sin_sdr"
    ? `<p>Llegó una respuesta de <b>${esc(d.clientName)}</b> y la empresa no tiene un SDR activo asignado. Asígnala para que no se pierda.</p>`
    : `<p>Llegó una respuesta de <b>${esc(d.clientName)}</b> que la IA no pudo clasificar con seguridad. Revísala.</p>`;
  return sendMail({
    from: fromAddress(),
    fromName: "BullsEye · Respuestas Lemlist",
    to: [to],
    subject: `⚠️ ${title}: ${d.leadName || d.leadEmail} (${d.clientName})`,
    html: wrap(title, intro + card(d)),
  });
}

// Modo sombra: un correo por corrida con lo que se habría hecho
export async function sendShadowDigest(to: string[], rows: { clientName: string; leadName: string; leadEmail: string; companyName: string; category: Category; summary: string; action: string; detail: string }[]) {
  const tr = rows.map((r) => `<tr>
<td style="padding:6px;border-bottom:1px solid #eee">${esc(r.clientName)}</td>
<td style="padding:6px;border-bottom:1px solid #eee">${esc(r.leadName || r.leadEmail)}<br><span style="color:#6b7280">${esc(r.companyName)}</span></td>
<td style="padding:6px;border-bottom:1px solid #eee"><b>${esc(CATEGORY_LABEL[r.category])}</b><br><span style="color:#6b7280">${esc(r.summary)}</span></td>
<td style="padding:6px;border-bottom:1px solid #eee">${esc(r.detail)}</td></tr>`).join("");
  return sendMail({
    from: fromAddress(),
    fromName: "BullsEye · Respuestas Lemlist",
    to,
    subject: `[Modo sombra] ${rows.length} respuesta(s) de Lemlist clasificadas`,
    html: wrap("Modo sombra: lo que se habría hecho", `<p>No se escribió en HubSpot, no se pausó en Lemlist ni se avisó a los SDR. Revisa si la clasificación y el SDR son correctos.</p>
<table style="border-collapse:collapse;font-size:13px;width:100%"><tr style="text-align:left;color:#6b7280"><th style="padding:6px">Cliente</th><th style="padding:6px">Contacto</th><th style="padding:6px">Interés</th><th style="padding:6px">Acción</th></tr>${tr}</table>`),
  });
}
