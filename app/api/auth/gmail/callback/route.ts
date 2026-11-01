import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state"); // user_id
  const error = req.nextUrl.searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  if (error || !code || !state) {
    return NextResponse.redirect(`${appUrl}/chat-v2?gmail_error=1`);
  }

  const clientId     = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri  = `${appUrl}/api/auth/gmail/callback`;

  // Intercambiar code por tokens (cache: no-store para evitar que Next.js cachee la respuesta)
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: "authorization_code",
    }),
  });

  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.access_token) {
    return NextResponse.redirect(`${appUrl}/chat-v2?gmail_error=1`);
  }

  // Obtener email desde userinfo de Google
  let email = "";
  try {
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = await userRes.json();
    console.log("[gmail/callback] userinfo status:", userRes.status, "body:", JSON.stringify(userInfo));
    email = userInfo.email ?? "";
  } catch (e) {
    console.error("[gmail/callback] userinfo error:", e);
  }

  // Fallback: extraer email del id_token si userinfo no lo devolvió
  if (!email && tokens.id_token) {
    try {
      const b64 = tokens.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
      console.log("[gmail/callback] id_token payload:", JSON.stringify(payload));
      email = payload.email ?? "";
    } catch (e) {
      console.error("[gmail/callback] id_token decode error:", e);
    }
  }

  console.log("[gmail/callback] final email:", email, "tokens keys:", Object.keys(tokens));

  const expiry = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();

  const db = supabaseAdmin();
  await db.from("user_gmail_tokens").upsert({
    user_id:       state,
    email,
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token ?? "",
    token_expiry:  expiry,
    updated_at:    new Date().toISOString(),
  }, { onConflict: "user_id" });

  return NextResponse.redirect(`${appUrl}/chat-v2?gmail_ok=1`);
}
