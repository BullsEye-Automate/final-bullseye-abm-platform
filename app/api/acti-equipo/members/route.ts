import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { listActiMembers, requireInternalUser } from "@/lib/acti/server";

export const dynamic = "force-dynamic";

// Socios ACTI (equipo BullsEye): para la etiqueta / filtro en Clientes y la
// vista de socios. `ready = false` si la migración aún no se corrió.
export async function GET() {
  const auth = await requireInternalUser();
  if (auth.response) return auth.response;
  const { members, ready } = await listActiMembers();
  const ids = members.map((m) => m.client_id);
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await supabaseAdmin().from("clients").select("id, name").in("id", ids);
    for (const c of data ?? []) names.set(c.id as string, c.name as string);
  }
  return NextResponse.json({
    ready,
    members: members.map((m) => ({ ...m, client_name: names.get(m.client_id) ?? "—" })),
  });
}
