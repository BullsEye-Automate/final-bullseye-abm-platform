import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard delete de un contacto. contact_feedback queda intacto (FK on delete set null).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  const { data: existing, error: fetchErr } = await db
    .from("contacts")
    .select("id, first_name, last_name")
    .eq("id", params.id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const { error: delErr } = await db.from("contacts").delete().eq("id", params.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ deleted: true, id: params.id });
}
