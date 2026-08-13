import { NextResponse } from "next/server";

// Proxy server-side hacia PUT /meetings/:id/contacto-linkedin de peitho-backend
// — mismo motivo que el proxy de /research: el formulario corre en el
// navegador (LinkedinUrlForm, client component) y llamar al backend directo
// pegaría contra CORS.
function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const body = await req.text();
  const res = await fetch(`${backendUrl()}/meetings/${params.id}/contacto-linkedin`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
