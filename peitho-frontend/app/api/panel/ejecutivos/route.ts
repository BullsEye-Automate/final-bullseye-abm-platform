import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Proxy server-side hacia GET /panel/ejecutivos — alimenta el selector cascada
// (cliente → ejecutivo) de PanelDeControlView, que refetchea esta lista cada
// vez que cambia el cliente elegido.
export async function GET(req: Request) {
  const token = await getAccessToken();
  const { search } = new URL(req.url);
  const res = await fetch(`${backendUrl()}/panel/ejecutivos${search}`, {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
