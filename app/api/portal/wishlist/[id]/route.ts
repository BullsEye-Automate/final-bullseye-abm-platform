import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requirePortalUser } from "@/lib/portalAuth";
import { getClientOwnLemlistKey, removeCompaniesFromList } from "@/lib/lemlistDatabase";

export const dynamic = "force-dynamic";

// DELETE — el cliente quita una empresa de su wishlist. Solo mientras
// prospección no la tomó (new / in_lemlist). Si ya estaba en la lista
// "Wishlist BullsEye" de su Lemlist, se saca de la lista (la empresa queda en
// su CRM de Lemlist, no se borra).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requirePortalUser();
  if (!user) return response;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("client_wishlist")
    .delete()
    .eq("id", params.id)
    .eq("client_id", user.clientId)
    .in("status", ["new", "in_lemlist"])
    .select("snapshot");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) {
    return NextResponse.json({ error: "No se puede quitar: BullsEye ya está trabajando esta empresa" }, { status: 409 });
  }

  const snap = (data[0].snapshot ?? {}) as { lemlist_company_id?: string; lemlist_list_id?: string };
  if (snap.lemlist_company_id && snap.lemlist_list_id) {
    const key = await getClientOwnLemlistKey(db, user.clientId);
    if (key) await removeCompaniesFromList(key, snap.lemlist_list_id, [snap.lemlist_company_id]).catch(() => null);
  }
  return NextResponse.json({ ok: true });
}
