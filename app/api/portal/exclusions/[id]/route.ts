import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWishlistActor } from "@/lib/portalAuth";

export const dynamic = "force-dynamic";

// DELETE — quita un elemento de la lista de exclusión del cliente (y su copia
// en la lista interna de BullsEye, si coincide nombre + sitio)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireWishlistActor(req);
  if (!user) return response;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("client_exclusions")
    .delete()
    .eq("id", params.id)
    .eq("client_id", user.clientId)
    .select("kind, company_name, domain");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = data?.[0];
  if (!row) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  if (row.kind === "company") {
    let q = db
      .from("excluded_companies")
      .delete()
      .eq("client_id", user.clientId)
      .ilike("company_name", (row.company_name ?? row.domain) as string);
    q = row.domain ? q.eq("company_website", row.domain) : q.is("company_website", null);
    await q;
  }
  return NextResponse.json({ ok: true });
}
