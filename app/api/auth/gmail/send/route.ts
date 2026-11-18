import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function refreshAccessToken(userId: string, refreshToken: string): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) return null;

  const expiry = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  const db = supabaseAdmin();
  await db.from("user_gmail_tokens").update({
    access_token: data.access_token,
    token_expiry: expiry,
    updated_at:   new Date().toISOString(),
  }).eq("user_id", userId);

  return data.access_token;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtmlBody(body: string, senderName: string, clientName: string): string {
  const bodyHtml = escapeHtml(body).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>");
  const partnerLine = clientName
    ? `Marketing Partner - ${escapeHtml(clientName)}`
    : "Marketing Partner";
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222;margin:0;padding:0;">
<div>
  <p style="margin:0 0 1em 0;">${bodyHtml}</p>
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0e0e0;color:#555;font-size:13px;line-height:1.5;">
    <strong>${escapeHtml(senderName)}</strong><br>
    ${partnerLine}
  </div>
</div>
</body></html>`;
}

function encodeRfc2047(text: string): string {
  return /[^\x00-\x7F]/.test(text)
    ? `=?UTF-8?B?${Buffer.from(text).toString("base64")}?=`
    : text;
}

function buildRawEmail(from: string, senderName: string, to: string, subject: string, htmlBody: string): string {
  const encodedSubject = encodeRfc2047(subject);
  const encodedName = encodeRfc2047(senderName);
  const fromHeader = senderName ? `${encodedName} <${from}>` : from;
  const lines = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    htmlBody,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

export async function POST(req: NextRequest) {
  let userId: string | null = null;
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
    );
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {}
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { to, subject, body, clientId } = await req.json();
  if (!to || !subject || !body) {
    return NextResponse.json({ error: "to, subject y body son requeridos" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const [{ data: tokenRow }, { data: clientRow }] = await Promise.all([
    db.from("user_gmail_tokens")
      .select("email, access_token, refresh_token, token_expiry")
      .eq("user_id", userId)
      .single(),
    clientId
      ? db.from("clients").select("name, logo_url").eq("id", clientId).single()
      : Promise.resolve({ data: null }),
  ]);

  if (!tokenRow) {
    return NextResponse.json({ error: "Gmail no conectado" }, { status: 403 });
  }

  // Refrescar token si está vencido o por vencer (< 2 min)
  let accessToken = tokenRow.access_token;
  const expiry = new Date(tokenRow.token_expiry).getTime();
  if (Date.now() > expiry - 120_000) {
    const refreshed = await refreshAccessToken(userId, tokenRow.refresh_token);
    if (!refreshed) return NextResponse.json({ error: "Token de Gmail expirado, reconecta tu cuenta" }, { status: 403 });
    accessToken = refreshed;
  }

  // Obtener nombre del remitente desde Google
  let senderName = tokenRow.email.split("@")[0];
  try {
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      if (profile.name) senderName = profile.name;
    }
  } catch {}

  const htmlBody = buildHtmlBody(
    body,
    senderName,
    clientRow?.name ?? "",
  );

  const raw = buildRawEmail(tokenRow.email, senderName, to, subject, htmlBody);

  const gmailRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  const gmailData = await gmailRes.json();
  if (!gmailRes.ok) {
    console.error("Gmail send error:", gmailData);
    return NextResponse.json({ error: gmailData?.error?.message ?? "Error al enviar" }, { status: 500 });
  }

  // Registrar el correo en HubSpot de forma asíncrona (fire-and-forget)
  logEmailInHubspot({
    to,
    subject,
    body,
    senderEmail: tokenRow.email,
    senderName,
    clientId: clientId ?? null,
    sentAt: new Date().toISOString(),
  }).catch((err) => console.error("HubSpot email log error:", err));

  return NextResponse.json({ ok: true, messageId: gmailData.id });
}

async function logEmailInHubspot(opts: {
  to: string;
  subject: string;
  body: string;
  senderEmail: string;
  senderName: string;
  clientId: string | null;
  sentAt: string;
}) {
  const HS = "https://api.hubapi.com";

  // Elegir token: si el cliente tiene HubSpot propio, usarlo; si no, BullsEye
  let hsToken: string | undefined;
  if (opts.clientId) {
    const db = supabaseAdmin();
    const { data: cfg } = await db
      .from("client_configs")
      .select("hubspot_access_token")
      .eq("client_id", opts.clientId)
      .maybeSingle();
    const clientToken = (cfg as { hubspot_access_token?: string | null } | null)?.hubspot_access_token?.trim();
    if (clientToken) hsToken = clientToken;
  }
  const headers = {
    Authorization: `Bearer ${hsToken || process.env.HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };

  // Buscar el contacto destinatario por email
  const contactSearch = await fetch(`${HS}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: opts.to }] }],
      properties: ["email"],
      limit: 1,
    }),
  });
  const contactData = await contactSearch.json();
  const contactId: string | undefined = contactData.results?.[0]?.id;

  // Buscar el owner HubSpot del SDR por su email
  const ownerSearch = await fetch(`${HS}/crm/v3/owners?email=${encodeURIComponent(opts.senderEmail)}&limit=1`, {
    headers,
  });
  const ownerData = await ownerSearch.json();
  const ownerId: string | undefined = ownerData.results?.[0]?.id;

  // Crear el engagement de email en HubSpot
  const engagement: Record<string, unknown> = {
    properties: {
      hs_email_direction: "EMAIL",
      hs_email_status: "SENT",
      hs_email_subject: opts.subject,
      hs_email_text: opts.body,
      hs_email_html: opts.body,
      hs_timestamp: new Date(opts.sentAt).getTime(),
      hs_email_from_email: opts.senderEmail,
      hs_email_from_firstname: opts.senderName.split(" ")[0] ?? opts.senderName,
      hs_email_from_lastname: opts.senderName.split(" ").slice(1).join(" ") || undefined,
      hs_email_to_email: opts.to,
      ...(ownerId ? { hubspot_owner_id: ownerId } : {}),
    },
  };

  if (contactId) {
    engagement.associations = [
      {
        to: { id: contactId },
        types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 198 }],
      },
    ];
  }

  const createRes = await fetch(`${HS}/crm/v3/objects/emails`, {
    method: "POST",
    headers,
    body: JSON.stringify(engagement),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    console.error("HubSpot create email engagement failed:", JSON.stringify(err));
  }
}
