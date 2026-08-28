import { NextRequest, NextResponse } from "next/server";

// Endpoint de diagnóstico TEMPORAL — inspecciona el objeto crudo que
// devuelve la API de Allo para una llamada (sin pasar por toAlloCallItem,
// que solo mapea algunos campos), para ver si el score de desempeño SDR
// viene en un campo estructurado propio o solo dentro del texto de
// "summary". Se borra después de usarlo.
const ALLO_API = "https://api.withallo.com";

function alloHeaders() {
  const key = process.env.ALLO_API_KEY;
  if (!key) throw new Error("ALLO_API_KEY no configurada");
  return { Authorization: key, "Content-Type": "application/json" };
}

export async function GET(request: NextRequest) {
  try {
    const days = Number(request.nextUrl.searchParams.get("days") || "14");
    const dateTo = new Date().toISOString().slice(0, 10);
    const dateFrom = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const res = await fetch(`${ALLO_API}/v2/api/conversations/items/search`, {
      method: "POST",
      headers: alloHeaders(),
      body: JSON.stringify({
        type: "CALL",
        sort: "DATE",
        page: 1,
        size: 5,
        date_from: dateFrom,
        date_to: dateTo,
      }),
      cache: "no-store",
    });
    const d = await res.json();
    const items: any[] = d?.data ?? [];

    if (items.length === 0) {
      return NextResponse.json({ ok: true, note: "sin llamadas en el rango", raw_search_response: d });
    }

    // Detalle completo de la primera llamada con summary no vacío
    const withSummary = items.find((it) => it.summary) || items[0];
    const detailRes = await fetch(
      `${ALLO_API}/v2/api/conversations/items/${withSummary.id}?extend=transcript`,
      { headers: alloHeaders(), cache: "no-store" }
    );
    const detailData = await detailRes.json();

    return NextResponse.json({
      ok: true,
      search_item_keys: Object.keys(withSummary),
      search_item_full: withSummary,
      detail_keys: Object.keys(detailData?.data ?? detailData ?? {}),
      detail_full: detailData,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
