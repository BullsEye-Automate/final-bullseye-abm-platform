import { NextResponse } from "next/server";

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Proxy server-side hacia DELETE /clients/:id/documents/:documentId.
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; documentId: string } }
) {
  const res = await fetch(`${backendUrl()}/clients/${params.id}/documents/${params.documentId}`, {
    method: "DELETE",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
