import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requirePortalUser } from "@/lib/portalAuth";

export const dynamic = "force-dynamic";

// DELETE — el cliente quita una empresa de su wishlist. Solo mientras está
// "new" (si prospección ya la tomó, se gestiona con BullsEye).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requirePortalUser();
  if (!user) return response;
  const { data, error } = await supabaseAdmin()
    .from("client_wishlist")
    .delete()
    .eq("id", params.id)
    .eq("client_id", user.clientId)
    .eq("status", "new")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) {
    return NextResponse.json({ error: "No se puede quitar: BullsEye ya está trabajando esta empresa" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
