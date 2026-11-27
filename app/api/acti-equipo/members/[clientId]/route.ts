import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getActiMember, requireInternalUser, saveActiMember } from "@/lib/acti/server";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Marca ACTI de un cliente (equipo BullsEye): GET = estado, PUT = guardar.
export async function GET(_req: NextRequest, { params }: { params: { clientId: string } }) {
  const auth = await requireInternalUser();
  if (auth.response) return auth.response;
  if (!UUID_RE.test(params.clientId)) return NextResponse.json({ error: "Cliente inválido" }, { status: 400 });
  return NextResponse.json({ member: await getActiMember(params.clientId) });
}

export async function PUT(req: NextRequest, { params }: { params: { clientId: string } }) {
  const auth = await requireInternalUser();
  if (auth.response) return auth.response;
  if (!UUID_RE.test(params.clientId)) return NextResponse.json({ error: "Cliente inválido" }, { status: 400 });
  const { data: client } = await supabaseAdmin().from("clients").select("id").eq("id", params.clientId).maybeSingle();
  if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.is_acti !== "boolean") return NextResponse.json({ error: "Falta is_acti" }, { status: 400 });
  try {
    const member = await saveActiMember(params.clientId, body, auth.email);
    return NextResponse.json({ member });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = /acti_members|does not exist|relation/i.test(msg)
      ? "Falta correr la migración supabase/20261127_acti_fase1_migration.sql"
      : msg;
    return NextResponse.json({ error: hint }, { status: 500 });
  }
}
