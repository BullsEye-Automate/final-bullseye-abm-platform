import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Proxy server-side hacia POST /clients/sync-maestra — lo llama
// SyncMaestraButton (client component), mismo motivo CORS que los otros
// proxies de esta carpeta.
export async function POST() {
  const token = await getAccessToken();
  const res = await fetch(`${backendUrl()}/clients/sync-maestra`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
