import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Proxy server-side hacia POST /admin/calendar/bot/resync — fuerza una
// resincronización completa (no incremental) del calendario de
// bot@peithob2b.com, para reintentar eventos que Google no vuelve a mandar
// solo porque no cambiaron desde la última vez (ver BotCalendarResyncButton).
export async function POST() {
  const token = await getAccessToken();
  const res = await fetch(`${backendUrl()}/admin/calendar/bot/resync`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
