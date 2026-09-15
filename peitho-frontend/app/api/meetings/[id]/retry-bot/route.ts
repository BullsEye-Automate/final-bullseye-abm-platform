import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

// Proxy server-side hacia POST /meetings/:id/retry-bot de peitho-backend —
// mismo motivo que los otros proxies: RetryBotButton corre en el navegador.
function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const token = await getAccessToken();
  const res = await fetch(`${backendUrl()}/meetings/${params.id}/retry-bot`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
