import { NextResponse } from "next/server";

// Proxy server-side hacia POST /meetings/:id/research de peitho-backend —
// necesario porque el botón "Iniciar research" corre en el navegador
// (ResearchButton, client component) y llamar al backend directo pegaría
// contra CORS.
function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const res = await fetch(`${backendUrl()}/meetings/${params.id}/research`, { method: "POST" });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
