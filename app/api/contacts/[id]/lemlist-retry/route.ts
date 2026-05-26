import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushApprovedToLemlist } from "@/lib/lemlistPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/contacts/[id]/lemlist-retry
// Reintenta el push a Lemlist para un contacto que tuvo error.

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Limpiar el error anterior para permitir el reintento
  await db
    .from("contacts")
    .update({ lemlist_push_error: null })
    .eq("id", id);

  // Obtener client_id
  const { data: contact, error: fetchErr } = await db
    .from("contacts")
    .select("id, client_id, company_id")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });

  let clientId = contact.client_id ?? null;
  if (!clientId && contact.company_id) {
    const { data: co } = await db
      .from("companies")
      .select("client_id")
      .eq("id", contact.company_id)
      .maybeSingle();
    clientId = co?.client_id ?? null;
  }

  const result = await pushApprovedToLemlist(id, clientId);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    contactId: id,
    leadId: result.leadId,
  });
}
