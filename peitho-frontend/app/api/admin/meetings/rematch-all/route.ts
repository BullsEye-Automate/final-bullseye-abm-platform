import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Proxy server-side hacia POST /meetings/rematch-all — re-corre el match
// contra el excel de metas (ahora también por nombre real del contacto) para
// todas las reuniones que todavía no quedaron resueltas limpio (ver
// RematchMeetingsButton).
export async function POST() {
  const token = await getAccessToken();
  const res = await fetch(`${backendUrl()}/meetings/rematch-all`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
