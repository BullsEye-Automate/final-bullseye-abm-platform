import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { forwardToPeitho, loadPeithoClient } from "@/lib/peithoIntegration";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Peitho del cliente elegido, para el equipo de BullsEye (requiere sesión:
// /api/clients/[id]/* no es pública, ver middleware.ts). Además de las vistas
// permite gestionar los usuarios de Peitho del cliente.
async function handle(req: Request, { params }: { params: { id: string; path: string[] } }) {
  const db = supabaseAdmin();
  const client = await loadPeithoClient(db, params.id);
  if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  return forwardToPeitho(req, db, client, params.path, { internal: true });
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
