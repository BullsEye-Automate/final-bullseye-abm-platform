import { mailProvider, sendMail } from "@/lib/mailer";

// Correos del Centro de prospección (inteligencia, recomendaciones, alertas,
// recordatorios, costo de IA). Mismo remitente que las alertas de Células
// (alertas@notificaciones.bullseye-abm.com) y respuestas a la líder.
// CENTRO_ALERTS_MODE=test manda todo solo a la líder de prospección.

export const CENTRO_LEADER = "amadriz@bullseye-abm.com";
export const PROSPECTORAS = ["gcondori@bullseye-abm.com", "jnazar@bullseye-abm.com", "nmoreno@bullseye-abm.com"];
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://portal.bullseye-abm.com").replace(/\/$/, "");

const FROM = () =>
  process.env.CENTRO_ALERTS_FROM || process.env.CELULAS_ALERTS_FROM || (mailProvider() === "resend" ? "onboarding@resend.dev" : CENTRO_LEADER);

export const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function wrapMail(title: string, body: string, cta?: { href: string; label: string }): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;color:#1f1d3a">
<div style="background:#251762;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><b>Bulls<span style="color:#62E0D8">Eye</span></b> · Centro de prospección<div style="font-size:18px;margin-top:6px">${esc(title)}</div></div>
<div style="border:1px solid #e3e1f0;border-top:0;padding:18px 20px;border-radius:0 0 10px 10px;font-size:14px;line-height:1.5">${body}
${cta ? `<p style="margin-top:20px"><a href="${cta.href}" style="background:#251762;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${esc(cta.label)}</a></p>` : ""}
</div></div>`;
}

export async function sendCentroMail(p: { to: string[]; cc?: string[]; subject: string; html: string }): Promise<{ to: string[]; cc: string[] }> {
  const test = (process.env.CENTRO_ALERTS_MODE ?? "").toLowerCase() === "test";
  const uniq = (xs: string[]) => Array.from(new Set(xs.map((x) => x.trim().toLowerCase()).filter(Boolean)));
  const to = test ? [CENTRO_LEADER] : uniq(p.to);
  const cc = test ? [] : uniq(p.cc ?? []).filter((x) => !to.includes(x));
  if (!to.length) return { to, cc };
  await sendMail({ from: FROM(), fromName: "BullsEye · Centro de prospección", to, cc, replyTo: [CENTRO_LEADER], subject: test ? `[prueba] ${p.subject}` : p.subject, html: p.html });
  return { to, cc };
}
