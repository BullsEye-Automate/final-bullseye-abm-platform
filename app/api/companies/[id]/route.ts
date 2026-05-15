import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Edita campos editables de la empresa. Hoy soporta solo company_size
// (la IA a veces lo saca de fuentes secundarias y no del LinkedIn real),
// pero está armado para extender a más campos si hace falta.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as {
    company_size?: number | null;
  };

  const updates: Record<string, unknown> = {};
  if (body.company_size === null) {
    updates.company_size = null;
  } else if (typeof body.company_size === "number" && Number.isFinite(body.company_size)) {
    const v = Math.max(1, Math.min(100000, Math.floor(body.company_size)));
    updates.company_size = v;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No hay campos válidos para actualizar" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("companies")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select("id, company_size")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, company: data });
}

// Hard delete de una empresa. Cascade en FKs:
//  - contacts.company_id (on delete cascade) → se borran los contactos
//  - company_feedback.company_id (on delete cascade) → se borra el feedback
// Útil para sacar empresas con URLs alucinadas o data mala que no queremos
// que sigan ocupando la lista de exclusión del discovery.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  const { data: existing, error: fetchErr } = await db
    .from("companies")
    .select("id, company_name")
    .eq("id", params.id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const { error: delErr } = await db.from("companies").delete().eq("id", params.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ deleted: true, id: params.id, company_name: existing.company_name });
}
