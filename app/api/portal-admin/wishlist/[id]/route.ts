import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushWishlistItemToLemlist } from "@/lib/wishlistLemlist";

export const dynamic = "force-dynamic";

const STATUSES = ["new", "in_lemlist", "in_progress", "contacts_found", "discarded"];

// POST — { status?, internal_note? } actualiza una empresa solicitada
//        { action: "push_lemlist" } reintenta el envío a la cuenta Lemlist del cliente
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (body?.action === "push_lemlist") {
    const r = await pushWishlistItemToLemlist(supabaseAdmin(), params.id);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error ?? "Error" }, { status: 502 });
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body?.status !== undefined) {
    if (!STATUSES.includes(body.status)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
    patch.status = body.status;
  }
  if (body?.internal_note !== undefined) patch.internal_note = String(body.internal_note ?? "").slice(0, 2000) || null;

  const { error } = await supabaseAdmin().from("client_wishlist").update(patch).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
