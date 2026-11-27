import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireActiUser } from "@/lib/acti/server";
import { ActiIcpError, loadActiIcp, saveActiIcp, type IcpScope } from "@/lib/acti/icp";

export const dynamic = "force-dynamic";

// Mi ICP / Mi perfil comercial del socio ACTI: el mismo ICP de Sistema → ICP.
export async function GET() {
  const { s, response } = await requireActiUser();
  if (response) return response;
  return NextResponse.json(await loadActiIcp(supabaseAdmin(), s.user.clientId));
}

export async function PUT(req: NextRequest) {
  const { s, response } = await requireActiUser();
  if (response) return response;
  const body = await req.json().catch(() => null);
  const scope: IcpScope | null = body?.scope === "icp" || body?.scope === "perfil" ? body.scope : null;
  if (!scope || !body.fields || typeof body.fields !== "object") {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }
  try {
    const db = supabaseAdmin();
    const r = await saveActiIcp(db, s.user.clientId, scope, body.fields, s.user.email);
    return NextResponse.json({ ...r, ...(await loadActiIcp(db, s.user.clientId)) });
  } catch (e) {
    if (e instanceof ActiIcpError) return NextResponse.json({ error: e.message }, { status: 409 });
    console.error("acti icp:", e);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
}
