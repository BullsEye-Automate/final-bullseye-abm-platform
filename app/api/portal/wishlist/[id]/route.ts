import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requirePortalUser } from "@/lib/portalAuth";
import { getClientOwnLemlistKey, removeCompaniesFromList } from "@/lib/lemlistDatabase";
import { markRecommendation } from "@/lib/wishlist";
import { pushWishlistItemToLemlist } from "@/lib/wishlistLemlist";

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
    .select("snapshot, source, source_ref");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) {
    return NextResponse.json({ error: "No se puede quitar: BullsEye ya está trabajando esta empresa" }, { status: 409 });
  }

  const snap = (data[0].snapshot ?? {}) as { lemlist_company_id?: string; lemlist_list_id?: string };
  if (snap.lemlist_company_id && snap.lemlist_list_id) {
    const key = await getClientOwnLemlistKey(db, user.clientId);
    if (key) await removeCompaniesFromList(key, snap.lemlist_list_id, [snap.lemlist_company_id]).catch(() => null);
  }
  // Si venía de las recomendaciones IA, vuelve a quedar pendiente ahí
  await markRecommendation(db, user.clientId, data[0].source, data[0].source_ref, "pending");
  return NextResponse.json({ ok: true });
}

// POST — { action: "approve" | "reject", reason? } el cliente decide sobre una
// empresa que le PROPUSO BullsEye (status proposed).
//   approve → pasa a "new" y se envía a su Lemlist (luego la IA busca contactos)
//   reject  → "rejected_by_client" con el motivo (no vuelve a aparecer en búsquedas)
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requirePortalUser();
  if (!user) return response;
  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "approve" && action !== "reject") return NextResponse.json({ error: "Acción inválida" }, { status: 400 });

  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) || null : null;
  const { data, error } = await db
    .from("client_wishlist")
    .update(
      action === "approve"
        ? { status: "new", lemlist_status: "pendiente", client_decision_at: now, client_decision_by_email: user.email, updated_at: now }
        : { status: "rejected_by_client", client_reject_reason: reason, client_decision_at: now, client_decision_by_email: user.email, updated_at: now }
    )
    .eq("id", params.id)
    .eq("client_id", user.clientId)
    .eq("status", "proposed")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Esta propuesta ya fue respondida" }, { status: 409 });

  if (action === "approve") {
    const push = await pushWishlistItemToLemlist(db, params.id).catch((err) => ({ ok: false, error: String(err) }));
    return NextResponse.json({ ok: true, lemlist: push.ok ? "ok" : "pendiente" });
  }
  return NextResponse.json({ ok: true });
}
