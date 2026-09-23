import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Proxy server-side hacia GET/POST /clients/:id/executives (roster de
// ejecutivos, 23-09-2026) — lo llama ClientExecutivesManager (client
// component), mismo motivo CORS que los demás proxies de esta carpeta.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const token = await getAccessToken();
  const res = await fetch(`${backendUrl()}/clients/${params.id}/executives`, {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const token = await getAccessToken();
  const body = await req.text();
  const res = await fetch(`${backendUrl()}/clients/${params.id}/executives`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
