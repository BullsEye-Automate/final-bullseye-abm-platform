// Envío de correos desde Gmail (Google Workspace de BullsEye) usando la misma
// cuenta de servicio que lee las planillas (GOOGLE_SERVICE_ACCOUNT_JSON), con
// delegación de todo el dominio: la cuenta de servicio envía "como" la
// casilla indicada en `from` (ej. ihincapie@bullseye-abm.com).
//
// Requisitos (una sola vez, los hace un administrador de Google Workspace):
// 1. Google Cloud → proyecto de la cuenta de servicio → habilitar "Gmail API".
// 2. admin.google.com → Seguridad → Controles de API → Delegación de todo el
//    dominio → Agregar: Client ID de la cuenta de servicio (campo client_id
//    del JSON) con el alcance https://www.googleapis.com/auth/gmail.send
import { google } from "googleapis";

export type GmailMessage = {
  from: string;          // casilla de bullseye-abm.com desde la que se envía
  fromName?: string;
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
};

// Encabezados con tildes/ñ: codificación MIME "encoded-word" (RFC 2047).
function encodeHeader(v: string): string {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

export async function sendGmail(msg: GmailMessage): Promise<{ id: string }> {
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credentialsJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no configurado");
  const credentials = JSON.parse(credentialsJson);

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    subject: msg.from, // casilla que "envía" (delegación de dominio)
  });
  const gmail = google.gmail({ version: "v1", auth });

  const from = msg.fromName ? `${encodeHeader(msg.fromName)} <${msg.from}>` : msg.from;
  const headers = [
    `From: ${from}`,
    `To: ${msg.to.join(", ")}`,
    msg.cc?.length ? `Cc: ${msg.cc.join(", ")}` : null,
    `Subject: ${encodeHeader(msg.subject)}`,
    "MIME-Version: 1.0",
  ].filter((l): l is string => l !== null);
  const htmlPart = [
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(msg.html, "utf8").toString("base64"),
  ];
  let lines: string[];
  if (!msg.attachments?.length) {
    lines = [...headers, ...htmlPart];
  } else {
    // multipart/mixed: cuerpo HTML + adjuntos en base64.
    const boundary = `bullseye_${Date.now().toString(36)}`;
    lines = [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`, ...htmlPart];
    for (const a of msg.attachments) {
      lines.push(
        `--${boundary}`,
        `Content-Type: ${a.contentType}; name="${encodeHeader(a.filename)}"`,
        `Content-Disposition: attachment; filename="${encodeHeader(a.filename)}"`,
        "Content-Transfer-Encoding: base64",
        "",
        (a.content.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n")
      );
    }
    lines.push(`--${boundary}--`);
  }
  const raw = lines.join("\r\n");

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: Buffer.from(raw).toString("base64url") },
  });
  return { id: res.data.id ?? "" };
}
