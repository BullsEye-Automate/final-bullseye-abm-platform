import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateModule, loadAcademy } from "@/lib/academiaSdr/server/generate";
import { currentUserEmail, resolveClient } from "@/lib/academiaSdr/server/client";
import { getModuleDef } from "@/lib/academiaSdr/modules";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Genera UN módulo de la Academia SDR con IA (el navegador pide los 10,
// varios en paralelo). Usa los datos de entrada guardados con PUT.
// Body: { client_id, module_no }

export async function POST(request: NextRequest) {
  try {
    const db = supabaseAdmin();
    const body = await request.json().catch(() => null);
    const client = await resolveClient(db, body?.client_id);
    if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    const def = getModuleDef(Number(body?.module_no));
    if (!def) return NextResponse.json({ error: "Módulo inválido" }, { status: 400 });

    const academy = await loadAcademy(db, client.id);
    if (!academy.inputs.focusService || !academy.inputs.countries) {
      return NextResponse.json({ error: "Guarda primero el servicio foco y los países" }, { status: 400 });
    }

    const userEmail = await currentUserEmail();
    const mod = await generateModule({ db, clientId: client.id, moduleNo: def.no, inputs: academy.inputs, userEmail });
    await db
      .from("sdr_academies")
      .update({ generated_at: new Date().toISOString(), generated_by: userEmail, updated_at: new Date().toISOString() })
      .eq("client_id", client.id);
    return NextResponse.json({ module: mod });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
