import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/phone-lookups?linkedin_url=...&source=clay&since=ISO
// Devuelve el lookup más reciente para esa URL (después de `since` si se pasa).
export async function GET(req: NextRequest) {
  const url    = req.nextUrl.searchParams.get("linkedin_url");
  const source = req.nextUrl.searchParams.get("source");
  const since  = req.nextUrl.searchParams.get("since");
  if (!url) return NextResponse.json({ error: "linkedin_url requerido" }, { status: 400 });

  const db = supabaseAdmin();
  let q = db.from("phone_lookups")
    .select("phone, provider, source, created_at")
    .eq("linkedin_url", url)
    .order("created_at", { ascending: false })
    .limit(1);

  if (source) q = q.eq("source", source);
  if (since)  q = q.gte("created_at", since);

  const { data } = await q;
  return NextResponse.json({ lookup: data?.[0] ?? null });
}
