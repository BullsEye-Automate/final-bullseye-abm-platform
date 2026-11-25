import { NextRequest, NextResponse } from "next/server";
import { requireCentroUser } from "@/lib/centroProspeccion/access";
import { loadSugerencias } from "@/lib/centroProspeccion/intel/sugerencias";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET ?client_id= — sugerencias de la inteligencia aprobadas para presentar al
// cliente (todas las semanas). No cambian el ICP.
export async function GET(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const id = req.nextUrl.searchParams.get("client_id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "client_id inválido" }, { status: 400 });
  try {
    return NextResponse.json({ sugerencias: await loadSugerencias(supabaseAdmin(), id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, sugerencias: [] }, { status: 500 });
  }
}
