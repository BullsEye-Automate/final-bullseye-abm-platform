import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLO_API = "https://api.withallo.com";
function alloHeaders() {
  const key = process.env.ALLO_API_KEY;
  if (!key) throw new Error("ALLO_API_KEY no configurada");
  return { Authorization: key, "Content-Type": "application/json" };
}

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone")?.trim();
  if (!phone) return NextResponse.json({ calls: [] });

  const normalized = phone.replace(/[\s\-\(\)]/g, "");
  const localNumber = normalized.replace(/^\+\d{1,3}/, "");

  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 90);
  const dateFromStr = dateFrom.toISOString().slice(0, 10);
  const dateToStr = new Date().toISOString().slice(0, 10);

  const matched: any[] = [];
  const PAGE_SIZE = 100;
  const MAX_PAGES = 10;

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await fetch(`${ALLO_API}/v2/api/conversations/items/search`, {
        method: "POST",
        headers: alloHeaders(),
        body: JSON.stringify({ type: "CALL", sort: "DATE", page, size: PAGE_SIZE, date_from: dateFromStr, date_to: dateToStr }),
        cache: "no-store",
      });

      if (!r.ok) break;
      const d = await r.json();
      const all: any[] = d?.data ?? [];

      for (const c of all) {
        const n = (c.contact_number ?? "").replace(/[\s\-\(\)]/g, "");
        if (n === normalized || n.endsWith(localNumber)) {
          matched.push(c);
          if (matched.length >= 5) break;
        }
      }

      if (matched.length >= 5 || all.length < PAGE_SIZE) break;
    }

    const calls = matched.slice(0, 5).map((c: any) => ({
      id: c.id,
      date: c.date,
      direction: c.direction,
      duration: c.duration ?? 0,
      result: c.result ?? null,
      summary: c.summary ?? null,
      user: c.user?.name ?? null,
      recording_url: c.recording_url ?? c.recordingUrl ?? null,
    }));

    return NextResponse.json({ calls });
  } catch {
    return NextResponse.json({ calls: [] });
  }
}
