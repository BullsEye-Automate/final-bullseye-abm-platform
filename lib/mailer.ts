// Envío de correos transaccionales de la app (hoy: alertas diarias de
// Células SDR). Proveedor principal: Resend (https://resend.com), vía su API
// HTTP — sin dependencias. Variables en Vercel:
// - RESEND_API_KEY: API key de Resend (Settings → API Keys, permiso "Sending").
// Si no está configurada se intenta Gmail con la cuenta de servicio
// (lib/gmail.ts), que requiere delegación de dominio.
//
// Remitente: mientras el dominio bullseye-abm.com no esté verificado en
// Resend, solo se puede enviar desde onboarding@resend.dev y SOLO al correo
// dueño de la cuenta de Resend (sirve para el modo prueba). Para enviar a las
// líderes hay que verificar el dominio en Resend → Domains (registros DNS).
import { sendGmail } from "@/lib/gmail";

export type MailMessage = {
  from: string;          // ej. "alertas@bullseye-abm.com" o "onboarding@resend.dev"
  fromName?: string;
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  // Adjuntos (ej. el PNG del Reporte SDR). content = bytes del archivo.
  attachments?: MailAttachment[];
};

export type MailAttachment = { filename: string; content: Buffer; contentType: string };

export function mailProvider(): "resend" | "gmail" {
  return process.env.RESEND_API_KEY ? "resend" : "gmail";
}

export async function sendMail(msg: MailMessage): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return sendGmail(msg);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: msg.fromName ? `${msg.fromName} <${msg.from}>` : msg.from,
      to: msg.to,
      cc: msg.cc?.length ? msg.cc : undefined,
      subject: msg.subject,
      html: msg.html,
      attachments: msg.attachments?.length
        ? msg.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64"), content_type: a.contentType }))
        : undefined,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${(body as any)?.message || (body as any)?.error || "error desconocido"}`);
  }
  return { id: (body as any)?.id ?? "" };
}
