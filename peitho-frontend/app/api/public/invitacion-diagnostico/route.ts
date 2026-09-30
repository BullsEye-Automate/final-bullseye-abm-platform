import { NextResponse } from "next/server";

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Proxy server-side hacia POST /public/invitacion-diagnostico — sin
// getAccessToken (a propósito, /invitacion es pública y corre ANTES de que
// exista ninguna sesión). Best-effort: si esto falla, no hay nada más que
// hacer del lado del cliente, así que ni siquiera se propaga el error. Se
// espera el fetch (no fire-and-forget) porque una función serverless de
// Vercel puede congelarse apenas responde, cortando una llamada en vuelo.
export async function POST(req: Request) {
  const body = await req.text();
  await fetch(`${backendUrl()}/public/invitacion-diagnostico`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => {});
  return NextResponse.json({ status: "ok" });
}
