import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requirePortalUser } from "@/lib/portalAuth";

export const dynamic = "force-dynamic";

// DELETE — restaura una empresa omitida (vuelve a aparecer en las búsquedas)
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requirePortalUser();
  if (!user) return response;
  const { data, error } = await supabaseAdmin()
    .from("client_omitted_companies")
    .delete()
    .eq("id", params.id)
    .eq("client_id", user.clientId)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
