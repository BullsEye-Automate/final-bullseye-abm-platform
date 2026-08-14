import { NextResponse } from "next/server";

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Proxy server-side hacia POST /clients — el formulario de "nuevo cliente"
// corre en el navegador, así que llamar al backend directo chocaría con CORS
// (mismo patrón que /api/meetings/[id]/research).
export async function POST(req: Request) {
  const body = await req.text();
  const res = await fetch(`${backendUrl()}/clients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
