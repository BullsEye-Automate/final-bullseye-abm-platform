import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireActiUser } from "@/lib/acti/server";
import { canSeePulsoView } from "@/lib/acti/plans";
import { forwardToPeitho, loadPeithoClient } from "@/lib/peithoIntegration";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Peitho para socios ACTI: solo planes que lo incluyen (desde Crece) y solo
// lectura del análisis de sus reuniones (sin Panel de control, research ni
// reasignar ejecutivos). El cliente sale siempre de la sesión.
const ALLOWED = [/^\/me$/, /^\/meetings$/, /^\/meetings\/[A-Za-z0-9-]+$/, /^\/meetings\/[A-Za-z0-9-]+\/video$/, /^\/clients\/[A-Za-z0-9-]+\/executives$/];

async function handle(req: Request, { params }: { params: { path: string[] } }) {
  const { s, response } = await requireActiUser();
  if (response) return response;
  if (!canSeePulsoView(s.plan, "peitho")) {
    return NextResponse.json({ error: "Peitho está incluido desde el plan Crece" }, { status: 403 });
  }
  const path = "/" + params.path.map(encodeURIComponent).join("/");
  if (req.method !== "GET" || !ALLOWED.some((re) => re.test(path))) {
    return NextResponse.json({ error: "Acción no disponible" }, { status: 403 });
  }
  const db = supabaseAdmin();
  const client = await loadPeithoClient(db, s.user.clientId);
  if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  return forwardToPeitho(req, db, client, params.path, { internal: false });
}

export { handle as GET, handle as POST, handle as PUT };
