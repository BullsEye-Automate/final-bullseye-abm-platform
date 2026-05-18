// Backfill del engagement score para contactos ya en HubSpot.
//
// El push normal a HubSpot ya calcula y manda el score (ver
// lib/hubspotPush.ts). Este endpoint es para forzar un re-sync de
// TODOS los contactos en HubSpot, para que la propiedad nueva
// wecad_engagement_score se pueble en los contactos existentes que
// fueron sincronizados antes de este cambio.
//
// Procesamiento: paralelo en chunks de 5, cap de 30 por request. Si
// quedan más, el SDR repite.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { syncContactToHubSpot } from "@/lib/hubspotContactSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_LIMIT = 30;
const CONCURRENCY = 5;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { batch_limit?: number };
  const limit = Math.min(Math.max(1, body.batch_limit ?? DEFAULT_LIMIT), 100);

  const db = supabaseAdmin();

  // Contactos en HubSpot, ordenados por última actividad (priorizamos los
  // que tuvieron movimiento reciente — más probable que su score haya
  // cambiado).
  const { data: rows, error } = await db
    .from("contacts")
    .select("id, first_name, last_name")
    .not("hubspot_contact_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const contacts = (rows ?? []) as Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
  }>;

  if (contacts.length === 0) {
    return NextResponse.json({
      summary: { processed: 0, synced: 0, errors: 0, remaining_in_queue: 0 },
      results: []
    });
  }

  // Total en HubSpot para reportar remaining.
  const { count: totalInHubspot } = await db
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .not("hubspot_contact_id", "is", null);

  type PerResult = {
    id: string;
    contact_name: string;
    status: "synced" | "error";
    error?: string;
  };

  const results: PerResult[] = [];
  for (let i = 0; i < contacts.length; i += CONCURRENCY) {
    const chunk = contacts.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (c): Promise<PerResult> => {
        const fullName =
          [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "(sin nombre)";
        try {
          const r = await syncContactToHubSpot(db, c.id);
          if (r.ok) return { id: c.id, contact_name: fullName, status: "synced" };
          return {
            id: c.id,
            contact_name: fullName,
            status: "error",
            error: r.error
          };
        } catch (err) {
          return {
            id: c.id,
            contact_name: fullName,
            status: "error",
            error: err instanceof Error ? err.message : "sync failed"
          };
        }
      })
    );
    results.push(...chunkResults);
  }

  const summary = {
    processed: results.length,
    synced: results.filter((r) => r.status === "synced").length,
    errors: results.filter((r) => r.status === "error").length,
    remaining_in_queue: Math.max(0, (totalInHubspot ?? 0) - results.length)
  };

  return NextResponse.json({ summary, results });
}
