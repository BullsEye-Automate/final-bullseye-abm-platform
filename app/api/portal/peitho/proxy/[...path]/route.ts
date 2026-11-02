import { supabaseAdmin } from "@/lib/supabase";
import { requirePortalUser } from "@/lib/portalAuth";
import { forwardToPeitho, loadPeithoClient } from "@/lib/peithoIntegration";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Peitho en el portal del cliente: el cliente sale SIEMPRE de la sesión
// (client_users), nunca de la request.
async function handle(req: Request, { params }: { params: { path: string[] } }) {
  const { user, response } = await requirePortalUser();
  if (!user) return response;
  const db = supabaseAdmin();
  const client = await loadPeithoClient(db, user.clientId);
  if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  return forwardToPeitho(req, db, client, params.path, { internal: false });
}

export { handle as GET, handle as POST, handle as PUT };
