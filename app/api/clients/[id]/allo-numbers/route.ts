import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("client_allo_numbers")
    .select("id, allo_number, allo_number_name, created_at")
    .eq("client_id", params.id)
    .order("allo_number_name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ numbers: data ?? [] });
}

export async function POST(req: NextRequest, { params }: Params) {
  const body = await req.json().catch(() => null);
  const allo_number: string | undefined = body?.allo_number;
  if (!allo_number) return NextResponse.json({ error: "Se requiere allo_number" }, { status: 400 });

  const db = supabaseAdmin();

  // Un número solo puede estar gestionado por un cliente a la vez.
  // Si ya está asignado a otro cliente, avisamos en vez de robárselo en silencio.
  const { data: existing } = await db
    .from("client_allo_numbers")
    .select("client_id, clients(name)")
    .eq("allo_number", allo_number)
    .maybeSingle();

  if (existing && existing.client_id !== params.id) {
    const otherName = (existing as any).clients?.name ?? "otro cliente";
    return NextResponse.json(
      { error: `Este número ya está asignado a ${otherName}. Quítalo de ahí primero.` },
      { status: 409 }
    );
  }

  const { data, error } = await db
    .from("client_allo_numbers")
    .upsert(
      { client_id: params.id, allo_number, allo_number_name: body?.allo_number_name ?? null },
      { onConflict: "allo_number" }
    )
    .select("id, allo_number, allo_number_name, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ number: data });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const body = await req.json().catch(() => null);
  const id: string | undefined = body?.id;
  if (!id) return NextResponse.json({ error: "Se requiere id" }, { status: 400 });

  const db = supabaseAdmin();
  const { error } = await db
    .from("client_allo_numbers")
    .delete()
    .eq("client_id", params.id)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
