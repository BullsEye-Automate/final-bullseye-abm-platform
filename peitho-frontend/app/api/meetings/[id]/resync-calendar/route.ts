import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

// Proxy server-side hacia POST /meetings/:id/resync-calendar de peitho-backend
// — mismo motivo que los otros proxies (contacto-linkedin, research, client):
// el botón corre en el navegador (ResyncCalendarButton, client component).
function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const token = await getAccessToken();
  const res = await fetch(`${backendUrl()}/meetings/${params.id}/resync-calendar`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
