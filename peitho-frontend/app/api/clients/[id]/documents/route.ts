import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Proxy server-side hacia POST /clients/:id/documents — reempaqueta el
// multipart/form-data que llega del navegador en un FormData nuevo para
// reenviarlo (fetch/undici arma el boundary solo). Reenvía el token de
// sesión para que el backend valide que quien sube es admin (Fase E).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const token = await getAccessToken();
  const incoming = await req.formData();
  const file = incoming.get("file");
  if (!file) {
    return NextResponse.json({ error: 'Falta el archivo (campo "file")' }, { status: 400 });
  }

  const outgoing = new FormData();
  outgoing.append("file", file);

  const res = await fetch(`${backendUrl()}/clients/${params.id}/documents`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: outgoing,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
