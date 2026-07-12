import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// El modal de feedback llenaba el desplegable de "Sales Manager" según el
// cliente seleccionado en el sidebar, no según el cliente real de la
// reunión — así que reuniones que estuvieron mal asignadas de cliente (ver
// fix-client-mismatch) pueden tener guardado un sales manager que en
// realidad pertenece a OTRO cliente. Esto detecta y limpia esos casos:
// si el sdr_seleccionado guardado no está en la lista de sales_managers
// configurada para el client_id actual de la reunión, se vacía (mejor
// vacío que un dato incorrecto).
//
// GET            → lista los casos, sin modificar nada.
// GET ?commit=1  → vacía sdr_seleccionado en esos casos.
export async function GET(req: NextRequest) {
  const commit = req.nextUrl.searchParams.get("commit") === "1";
  const db = supabaseAdmin();

  const { data: configs, error: cfgError } = await db
    .from("feedback_config")
    .select("client_id, sales_managers");
  if (cfgError) return NextResponse.json({ error: cfgError.message }, { status: 500 });

  const managersByClient = new Map<string, string[]>();
  (configs ?? []).forEach((c) => managersByClient.set(c.client_id, c.sales_managers ?? []));

  const PAGE_SIZE = 1000;
  type Row = {
    id: string;
    sdr_seleccionado: string | null;
    meetings: { client_id: string; empresa: string } | { client_id: string; empresa: string }[] | null;
  };
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await db
      .from("meeting_feedback")
      .select("id, sdr_seleccionado, meetings!inner(client_id, empresa)")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!page || page.length === 0) break;
    rows.push(...(page as any));
    if (page.length < PAGE_SIZE) break;
  }

  const mismatches: { feedbackId: string; empresa: string; sdrGuardado: string }[] = [];
  for (const r of rows) {
    if (!r.sdr_seleccionado) continue;
    const meeting = Array.isArray(r.meetings) ? r.meetings[0] : r.meetings;
    if (!meeting) continue;
    const validos = managersByClient.get(meeting.client_id) ?? [];
    if (!validos.includes(r.sdr_seleccionado)) {
      mismatches.push({ feedbackId: r.id, empresa: meeting.empresa, sdrGuardado: r.sdr_seleccionado });
    }
  }

  if (!commit) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      total: mismatches.length,
      mismatches,
      nota: "Nada se modificó. Repetir con ?commit=1 para vaciar esos campos.",
    });
  }

  let limpiadas = 0;
  const errors: string[] = [];
  for (const m of mismatches) {
    const { error } = await db
      .from("meeting_feedback")
      .update({ sdr_seleccionado: null })
      .eq("id", m.feedbackId);
    if (error) errors.push(`${m.empresa}: ${error.message}`);
    else limpiadas++;
  }

  return NextResponse.json({
    ok: true,
    limpiadas,
    total: mismatches.length,
    errores: errors.length ? errors : undefined,
  });
}
