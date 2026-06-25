import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const VALID_LABELS = ["reunion_agendada", "no_interesado", "sin_respuesta", "numero_incorrecto"];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.client_id) {
    return NextResponse.json({ error: "client_id es requerido" }, { status: 400 });
  }
  if (!body.contact_id && !body.email) {
    return NextResponse.json({ error: "contact_id o email son requeridos" }, { status: 400 });
  }

  const db = supabaseAdmin();

  if (!body.label) {
    if (body.contact_id) {
      await db.from("contact_sdr_labels").delete().eq("contact_id", body.contact_id);
    } else {
      await db.from("contact_sdr_labels").delete()
        .eq("email", body.email).eq("client_id", body.client_id).is("contact_id", null);
    }
    return NextResponse.json({ ok: true });
  }

  if (!VALID_LABELS.includes(body.label)) {
    return NextResponse.json({ error: "Etiqueta no válida" }, { status: 400 });
  }

  let error: any;

  if (body.contact_id) {
    const res = await db.from("contact_sdr_labels").upsert(
      { contact_id: body.contact_id, client_id: body.client_id, label: body.label, updated_at: new Date().toISOString() },
      { onConflict: "contact_id" }
    );
    error = res.error;
  } else {
    const { data: existing } = await db.from("contact_sdr_labels").select("id")
      .eq("email", body.email).eq("client_id", body.client_id).is("contact_id", null).maybeSingle();
    if (existing?.id) {
      const res = await db.from("contact_sdr_labels")
        .update({ label: body.label, updated_at: new Date().toISOString() }).eq("id", existing.id);
      error = res.error;
    } else {
      const res = await db.from("contact_sdr_labels")
        .insert({ email: body.email, client_id: body.client_id, label: body.label, updated_at: new Date().toISOString() });
      error = res.error;
    }
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
