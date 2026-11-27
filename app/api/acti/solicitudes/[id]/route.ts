import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireActiUser } from "@/lib/acti/server";
import { ActiRequestError, cancelRequest } from "@/lib/acti/requests";

export const dynamic = "force-dynamic";

// DELETE → cancela una solicitud que sigue en cola (libera el cupo)
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { s, response } = await requireActiUser();
  if (response) return response;
  try {
    await cancelRequest(supabaseAdmin(), s.user.clientId, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ActiRequestError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "No se pudo cancelar" }, { status: 500 });
  }
}
