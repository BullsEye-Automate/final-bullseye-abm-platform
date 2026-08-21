import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Proxy server-side hacia GET /me — lo usa Sidebar (client component) para
// saber el rol del usuario logueado y decidir qué mostrar en la navegación.
export async function GET() {
  const token = await getAccessToken();
  const res = await fetch(`${backendUrl()}/me`, {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
