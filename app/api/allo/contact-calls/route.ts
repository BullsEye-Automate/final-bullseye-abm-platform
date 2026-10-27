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

  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 90);
  const dateFromStr = dateFrom.toISOString().slice(0, 10);
  const dateToStr = new Date().toISOString().slice(0, 10);

  try {
    const body = {
      type: "CALL",
      sort: "DATE",
      page: 1,
      size: 100,
      date_from: dateFromStr,
      date_to: dateToStr,
    };

    const r = await fetch(`${ALLO_API}/v2/api/conversations/items/search`, {
      method: "POST",
      headers: alloHeaders(),
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!r.ok) return NextResponse.json({ calls: [] });
    const d = await r.json();
    const all: any[] = d?.data ?? [];

    const matched = all.filter((c: any) => {
      const n = (c.contact_number ?? "").replace(/[\s\-\(\)]/g, "");
      return n === normalized || n.endsWith(normalized.replace(/^\+\d{1,3}/, ""));
    }).slice(0, 5);

    const calls = matched.map((c: any) => ({
      id: c.id,
      date: c.date,
      direction: c.direction,
      duration: c.duration ?? 0,
      result: c.result ?? null,
      summary: c.summary ?? null,
      user: c.user?.name ?? null,
    }));

    return NextResponse.json({ calls });
  } catch {
    return NextResponse.json({ calls: [] });
  }
}
