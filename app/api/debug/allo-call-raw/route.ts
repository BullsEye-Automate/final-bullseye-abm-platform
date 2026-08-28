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
    const minLen = Number(request.nextUrl.searchParams.get("minLen") || "400");
    const pagesToScan = Number(request.nextUrl.searchParams.get("pages") || "5");
    const dateTo = new Date().toISOString().slice(0, 10);
    const dateFrom = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const longSummaryItems: any[] = [];
    let scanned = 0;
    for (let page = 1; page <= pagesToScan; page++) {
      const res = await fetch(`${ALLO_API}/v2/api/conversations/items/search`, {
        method: "POST",
        headers: alloHeaders(),
        body: JSON.stringify({
          type: "CALL",
          sort: "DATE",
          page,
          size: 100,
          date_from: dateFrom,
          date_to: dateTo,
        }),
        cache: "no-store",
      });
      const d = await res.json();
      const items: any[] = d?.data ?? [];
      scanned += items.length;
      for (const it of items) {
        if (typeof it.summary === "string" && it.summary.length >= minLen) {
          longSummaryItems.push(it);
        }
      }
      if (!d?.pagination?.has_more || items.length === 0) break;
    }

    if (longSummaryItems.length === 0) {
      return NextResponse.json({
        ok: true,
        note: `sin llamadas con summary >= ${minLen} chars en ${scanned} escaneadas`,
      });
    }

    // Detalle completo de hasta 2 llamadas con summary largo (formato rico)
    const picks = longSummaryItems.slice(0, 2);
    const details = await Promise.all(
      picks.map(async (it) => {
        const detailRes = await fetch(
          `${ALLO_API}/v2/api/conversations/items/${it.id}?extend=transcript`,
          { headers: alloHeaders(), cache: "no-store" }
        );
        return detailRes.json();
      })
    );

    return NextResponse.json({
      ok: true,
      scanned,
      found_with_long_summary: longSummaryItems.length,
      details,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
