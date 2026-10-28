import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, getUserIdFromRequest } from "@/lib/supabase";

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

function buildRawEmail(from: string, to: string, subject: string, body: string): string {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    body,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { to, subject, body } = await req.json();
  if (!to || !subject || !body) {
    return NextResponse.json({ error: "to, subject y body son requeridos" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: tokenRow } = await db
    .from("user_gmail_tokens")
    .select("email, access_token, refresh_token, token_expiry")
    .eq("user_id", userId)
    .single();

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

  const raw = buildRawEmail(tokenRow.email, to, subject, body);

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

  return NextResponse.json({ ok: true, messageId: gmailData.id });
}
