import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

// Proxy server-side hacia PUT /meetings/:id/client de peitho-backend — mismo
// motivo que los otros proxies (contacto-linkedin, research): el formulario
// corre en el navegador (AssignClientForm, client component).
function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const token = await getAccessToken();
  const body = await req.text();
  const res = await fetch(`${backendUrl()}/meetings/${params.id}/client`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
