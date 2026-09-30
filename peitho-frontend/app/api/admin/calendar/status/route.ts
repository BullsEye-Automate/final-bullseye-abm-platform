import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Proxy server-side hacia GET /admin/calendar/status — estado de
// sincronización de cada cuenta de Google conectada (ver
// BotCalendarResyncButton).
export async function GET() {
  const token = await getAccessToken();
  const res = await fetch(`${backendUrl()}/admin/calendar/status`, {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
