import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

// Proxy server-side hacia POST/DELETE /meetings/:id/analysis/share de
// peitho-backend — mismo motivo que los demás proxies de esta carpeta
// (ShareAnalysisButton corre en el navegador, CORS no está configurado en
// el backend para esta ruta).
function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const token = await getAccessToken();
  const res = await fetch(`${backendUrl()}/meetings/${params.id}/analysis/share`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const token = await getAccessToken();
  const res = await fetch(`${backendUrl()}/meetings/${params.id}/analysis/share`, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
