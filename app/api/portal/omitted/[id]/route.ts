import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWishlistActor } from "@/lib/portalAuth";
import { markRecommendation } from "@/lib/wishlist";

export const dynamic = "force-dynamic";

// DELETE — restaura una empresa omitida (vuelve a aparecer en las búsquedas)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireWishlistActor(req);
  if (!user) return response;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("client_omitted_companies")
    .delete()
    .eq("id", params.id)
    .eq("client_id", user.clientId)
    .select("id, source, source_ref");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  // Si era una recomendación IA, vuelve a quedar pendiente en "Recomendadas por IA"
  await markRecommendation(db, user.clientId, data[0].source, data[0].source_ref, "pending");
  return NextResponse.json({ ok: true });
}
