import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

const RELEVANCE_RANK: Record<string, number> = { alta: 3, media: 2, baja: 1 };

export async function GET(req: NextRequest, { params }: Params) {
  const db = supabaseAdmin();
  const isAllClients = params.id === "__all__";
  const onlyUnreviewed = req.nextUrl.searchParams.get("reviewed") === "false";

  let query = db
    .from("allo_call_signals")
    .select("*")
    .not("top_relevance", "is", null)
    .order("call_date", { ascending: false })
    .limit(300);

  if (!isAllClients) query = query.eq("client_id", params.id);
  if (onlyUnreviewed) query = query.eq("reviewed", false);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // "alta"/"media"/"baja" ordenado alfabéticamente no respeta la severidad —
  // se reordena acá en vez de en el query builder de Supabase.
  const signals = (data ?? []).sort((a, b) => {
    const ra = RELEVANCE_RANK[a.top_relevance as string] ?? 0;
    const rb = RELEVANCE_RANK[b.top_relevance as string] ?? 0;
    if (ra !== rb) return rb - ra;
    return (b.call_date ?? "").localeCompare(a.call_date ?? "");
  });

  return NextResponse.json({ signals });
}

export async function PATCH(req: NextRequest, { params: _params }: Params) {
  const body = await req.json().catch(() => ({}));
  const { signal_id, reviewed } = body as { signal_id?: string; reviewed?: boolean };
  if (!signal_id) return NextResponse.json({ error: "Se requiere signal_id" }, { status: 400 });

  const db = supabaseAdmin();
  const { error } = await db
    .from("allo_call_signals")
    .update({ reviewed: reviewed ?? true })
    .eq("id", signal_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
