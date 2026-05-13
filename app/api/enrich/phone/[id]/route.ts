import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { enrichContactPhone } from "@/lib/phoneEnrichment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Enriquece teléfono de un contacto puntual. Llamado por:
//   1. La UI de /contactos (botón manual "Buscar teléfono").
//   2. El HubSpot Workflow webhook cuando SDR cambia
//      wecad_phone_enrichment_status = "requested".
//   3. El cron de /api/cron/enrich-phones (loop interno).
//
// Auth: opcional via header x-webhook-secret o Authorization: Bearer.
// Si CRON_SECRET está set, se exige match. Sin secret env, abierto
// (útil para llamadas desde la propia UI del app).

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const expected = process.env.CRON_SECRET ?? "";
  if (expected) {
    const got =
      req.headers.get("x-webhook-secret") ??
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      "";
    // Si el caller es la propia UI (cookie next-auth / sin headers), saltamos.
    // Sólo exigimos auth si vino algún header pretendiendo serlo.
    const sentSomething =
      req.headers.has("x-webhook-secret") || req.headers.has("authorization");
    if (sentSomething && got !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const db = supabaseAdmin();
  const result = await enrichContactPhone(db, params.id);
  return NextResponse.json(result);
}
