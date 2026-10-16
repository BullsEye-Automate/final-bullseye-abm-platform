import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET — empresas solicitadas por los clientes desde el portal
// ?status=new (default) | in_lemlist | in_progress | contacts_found | discarded | all · ?client_id=
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") || "new";
  const clientId = req.nextUrl.searchParams.get("client_id");
  let q = supabaseAdmin()
    .from("client_wishlist")
    .select("*, clients(name)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (status !== "all") q = q.eq("status", status);
  if (clientId) q = q.eq("client_id", clientId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const items = (data ?? []).map(({ clients, ...r }) => ({
    ...r,
    client_name: (Array.isArray(clients) ? clients[0] : clients)?.name ?? "—",
  }));
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
