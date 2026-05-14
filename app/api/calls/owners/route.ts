import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/calls/owners
// Devuelve la lista única de SDRs (hubspot_owner_id + nombre) que tienen
// al menos una llamada registrada. Sirve para llenar el filtro de SDR
// en /llamadas y /llamadas/reporte.
type Row = { hubspot_owner_id: string | null; owner_name: string | null };

export async function GET(_req: NextRequest) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("calls")
    .select("hubspot_owner_id, owner_name")
    .not("hubspot_owner_id", "is", null)
    .limit(10000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as Row[];
  const byId = new Map<string, { hubspot_owner_id: string; name: string; calls: number }>();
  for (const r of rows) {
    if (!r.hubspot_owner_id) continue;
    const entry = byId.get(r.hubspot_owner_id) ?? {
      hubspot_owner_id: r.hubspot_owner_id,
      name: r.owner_name ?? "(sin nombre)",
      calls: 0
    };
    entry.calls++;
    if (r.owner_name && entry.name === "(sin nombre)") entry.name = r.owner_name;
    byId.set(r.hubspot_owner_id, entry);
  }
  const owners = Array.from(byId.values()).sort((a, b) => b.calls - a.calls);
  return NextResponse.json({ owners });
}
