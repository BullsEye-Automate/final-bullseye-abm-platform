import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Proxy server-side hacia DELETE /admin/user-roles/:userId.
export async function DELETE(_req: Request, { params }: { params: { userId: string } }) {
  const token = await getAccessToken();
  const res = await fetch(`${backendUrl()}/admin/user-roles/${params.userId}`, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
