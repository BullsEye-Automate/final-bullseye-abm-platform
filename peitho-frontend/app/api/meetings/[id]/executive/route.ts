import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

// Proxy server-side hacia PUT /meetings/:id/executive de peitho-backend
// (23-09-2026) — lo llama MeetingExecutiveSelect (client component),
// disponible para cualquier rol "client" de la misma empresa, no solo admin.
function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const token = await getAccessToken();
  const body = await req.text();
  const res = await fetch(`${backendUrl()}/meetings/${params.id}/executive`, {
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
