import { NextRequest, NextResponse } from "next/server";
import { alloFetchRaw } from "@/lib/allo";

export const dynamic = "force-dynamic";

// Diagnóstico temporal: muestra la respuesta cruda (status + body) de Allo
// para /v2/api/analytics/outbound y para la búsqueda con/sin filtro de
// dirección, para confirmar el formato exacto que espera la API. Borrar una
// vez resuelto.
export async function GET(req: NextRequest) {
  const allo_number = req.nextUrl.searchParams.get("allo_number") ?? "+56233884946";
  const date_from = req.nextUrl.searchParams.get("date_from") ?? "2026-08-01";
  const date_to = req.nextUrl.searchParams.get("date_to") ?? "2026-08-24";

  async function probe(label: string, path: string, body: Record<string, unknown>) {
    try {
      const res = await alloFetchRaw(path, { method: "POST", body: JSON.stringify(body) });
      const text = await res.text().catch(() => "");
      return { label, status: res.status, bodySnippet: text.slice(0, 800) };
    } catch (e: any) {
      return { label, status: null, error: e.message };
    }
  }

  const results = await Promise.all([
    probe("analytics/outbound", "/v2/api/analytics/outbound", { allo_numbers: [allo_number], date_from, date_to }),
    probe(
      "search sin direction",
      "/v2/api/conversations/items/search",
      { type: "CALL", allo_number, date_from, date_to, page: 1, size: 1 }
    ),
    probe(
      "search con direction=OUTBOUND",
      "/v2/api/conversations/items/search",
      { type: "CALL", allo_number, date_from, date_to, direction: "OUTBOUND", page: 1, size: 1 }
    ),
    probe(
      "search con direction=INBOUND",
      "/v2/api/conversations/items/search",
      { type: "CALL", allo_number, date_from, date_to, direction: "INBOUND", page: 1, size: 1 }
    ),
  ]);

  return NextResponse.json({ params: { allo_number, date_from, date_to }, results });
}
