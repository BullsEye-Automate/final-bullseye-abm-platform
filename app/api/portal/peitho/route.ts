import { NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/portalAuth";
import { supabaseAdmin } from "@/lib/supabase";
import { isPeithoEnabled } from "@/lib/peitho";

export const dynamic = "force-dynamic";

// ¿El cliente de la sesión tiene Peitho contratado? (Pulso ABM → Peitho)
export async function GET() {
  const { user, response } = await requirePortalUser();
  if (!user) return response;
  const db = supabaseAdmin();
  const [enabled, { data: client }] = await Promise.all([
    isPeithoEnabled(db, user.clientId),
    db.from("clients").select("name").eq("id", user.clientId).maybeSingle(),
  ]);
  return NextResponse.json({ enabled, client_name: client?.name ?? null });
}
