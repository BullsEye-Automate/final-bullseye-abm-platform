import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { loadAcademy, loadClientMaterials } from "@/lib/academiaSdr/server/generate";
import { currentUserEmail, resolveClient } from "@/lib/academiaSdr/server/client";
import { sanitizeInputs } from "@/lib/academiaSdr/types";

export const dynamic = "force-dynamic";

// Academia SDR de un cliente (tablas sdr_academies / sdr_academy_modules,
// ver supabase/20261028_academia_sdr_migration.sql).
//   GET ?client_id=  → datos de entrada, módulos generados y resumen del contexto
//   PUT ?client_id=  → guarda los datos de entrada ({ inputs })

export async function GET(request: NextRequest) {
  try {
    const db = supabaseAdmin();
    const client = await resolveClient(db, request.nextUrl.searchParams.get("client_id"));
    if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    const [academy, materials] = await Promise.all([loadAcademy(db, client.id), loadClientMaterials(db, client.id)]);
    return NextResponse.json({ academy, materials: { docCount: materials.docCount, hasIcp: materials.hasIcp } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const db = supabaseAdmin();
    const client = await resolveClient(db, request.nextUrl.searchParams.get("client_id"));
    if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    const body = await request.json().catch(() => null);
    const inputs = sanitizeInputs(body?.inputs);
    if (!inputs.focusService || !inputs.countries) {
      return NextResponse.json({ error: "Completa el servicio foco y los países de esta fase" }, { status: 400 });
    }
    const { error } = await db
      .from("sdr_academies")
      .upsert({ client_id: client.id, inputs, generated_by: await currentUserEmail(), updated_at: new Date().toISOString() }, { onConflict: "client_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ inputs });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
