import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Proxy server-side hacia GET /clients/:id/documents/:documentId/download —
// mismo patrón que el DELETE de la carpeta hermana. Devuelve una URL firmada
// de corta duración (ver getKnowledgeBaseDocumentDownloadUrl en el backend),
// no el archivo en sí — el frontend abre esa URL directo en una pestaña
// nueva.
export async function GET(
  _req: Request,
  { params }: { params: { id: string; documentId: string } }
) {
  const token = await getAccessToken();
  const res = await fetch(`${backendUrl()}/clients/${params.id}/documents/${params.documentId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: "no-store",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
