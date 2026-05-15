// Marca un contacto como descartado sin borrarlo. Usado desde el botón
// "Descartar" del bucket "Por aprobar" en /contactos cuando el SDR
// revisa un contacto auto-enrich y decide que no vale para outreach.
//
// Setea status='discarded' + human_decision='rejected' + razón opcional.
// El feedback queda en contact_feedback para entrenamiento futuro.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const reason = body.reason?.trim() || "Descartado desde bucket Por aprobar";

  const db = supabaseAdmin();

  const { data: existing, error: fetchErr } = await db
    .from("contacts")
    .select(
      "id, first_name, last_name, fit_score, fit_action, fit_reason, human_decision"
    )
    .eq("id", params.id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const { error: updateErr } = await db
    .from("contacts")
    .update({
      status: "discarded",
      human_decision: "rejected",
      human_decision_at: new Date().toISOString(),
      human_decision_reason: reason,
      updated_at: new Date().toISOString()
    })
    .eq("id", params.id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Persistimos el feedback para entrenamiento futuro (la IA decidió
  // 'enrich' pero el humano lo descartó — señal útil para refinar).
  // Best-effort: si falla, no rompemos el discard.
  try {
    await db.from("contact_feedback").insert({
      contact_id: params.id,
      claude_score: (existing as any).fit_score ?? null,
      claude_action: (existing as any).fit_action ?? null,
      claude_reason: (existing as any).fit_reason ?? null,
      human_action: "rejected",
      human_reason: reason
    });
  } catch {
    // ignore — el feedback es accesorio, no rompe la operación.
  }

  return NextResponse.json({ ok: true });
}
