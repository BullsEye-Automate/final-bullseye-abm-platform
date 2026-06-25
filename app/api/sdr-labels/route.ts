import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const VALID_LABELS = ["reunion_agendada", "no_interesado", "sin_respuesta", "numero_incorrecto"];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.contact_id || !body?.client_id) {
    return NextResponse.json({ error: "contact_id y client_id son requeridos" }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Si label es null o vacío, eliminar etiqueta
  if (!body.label) {
    await db.from("contact_sdr_labels").delete().eq("contact_id", body.contact_id);
    return NextResponse.json({ ok: true });
  }

  if (!VALID_LABELS.includes(body.label)) {
    return NextResponse.json({ error: "Etiqueta no válida" }, { status: 400 });
  }

  const { error } = await db
    .from("contact_sdr_labels")
    .upsert(
      {
        contact_id: body.contact_id,
        client_id:  body.client_id,
        label:      body.label,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "contact_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
