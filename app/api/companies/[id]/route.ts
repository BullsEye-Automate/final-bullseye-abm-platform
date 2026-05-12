import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
