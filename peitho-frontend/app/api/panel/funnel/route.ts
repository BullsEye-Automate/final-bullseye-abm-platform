import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/peithoAuth";

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Proxy server-side hacia GET /panel/funnel — lo usa PanelDeControlView
// (client component) porque los filtros (fecha, umbral, cliente) recalculan
// en el backend en vez de filtrar una lista ya traída, a diferencia de
// ReunionesFuturasView/ReunionesPasadasView.
export async function GET(req: Request) {
  const token = await getAccessToken();
  const { search } = new URL(req.url);
  const res = await fetch(`${backendUrl()}/panel/funnel${search}`, {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
