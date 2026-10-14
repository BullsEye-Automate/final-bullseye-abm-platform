import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Proxy server-side hacia POST /clients/:id/executives/rematch — reintenta
// vincular reuniones viejas contra el roster actual (ver botón "Revincular
// reuniones" en ClientExecutivesManager.tsx).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const token = await getAccessToken();
  const res = await fetch(`${backendUrl()}/clients/${params.id}/executives/rematch`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
