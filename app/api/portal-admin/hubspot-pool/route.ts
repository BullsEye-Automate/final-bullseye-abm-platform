import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSyncState, listPoolProperties, syncPoolChunk } from "@/lib/hubspotPool";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET — estado de la base HubSpot usada por la wishlist
export async function GET() {
  const db = supabaseAdmin();
  const [state, properties] = await Promise.all([getSyncState(db), listPoolProperties(db)]);
  return NextResponse.json({ state, properties: properties.map((p) => ({ name: p.name, label: p.label, filled_count: p.filled_count })) });
}

// POST — { restart?: boolean } sincroniza un tramo (~2.000 empresas).
// La pantalla interna lo llama en loop hasta que done = true.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    const result = await syncPoolChunk(supabaseAdmin(), !!body?.restart);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
