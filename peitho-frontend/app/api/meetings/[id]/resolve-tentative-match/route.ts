import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

// Proxy server-side hacia POST /meetings/:id/resolve-tentative-match de
// peitho-backend — mismo motivo que los otros proxies: TentativeMatchReview
// corre en el navegador.
function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const token = await getAccessToken();
  const body = await req.text();
  const res = await fetch(`${backendUrl()}/meetings/${params.id}/resolve-tentative-match`, {
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
