import { NextRequest, NextResponse } from "next/server";
import { isCentroOwner, requireCentroUser } from "@/lib/centroProspeccion/access";
import { getAmpliarClients, setAmpliar } from "@/lib/centroProspeccion/recoAmpliar";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET = clientes con «ampliar búsqueda» encendido (aprobado por el cliente).
// PUT { client_id, on, nota } = encender (exige nota con el respaldo de la
// aprobación del cliente) o apagar. POST { action: "restaurar" } = vuelve a
// los filtros del ICP a los clientes sin aprobación (borra el avance guardado
// de la búsqueda; la próxima tanda parte desde el ICP). Solo la dueña del Centro.
export async function GET() {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  return NextResponse.json({ clients: await getAmpliarClients() });
}

export async function PUT(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  if (!isCentroOwner(u.email)) return NextResponse.json({ error: "Solo la líder del Centro" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const id = String(b.client_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "client_id inválido" }, { status: 400 });
  const on = b.on === true;
  const nota = String(b.nota ?? "").trim();
  if (on && nota.length < 5) return NextResponse.json({ error: "Indica el respaldo de la aprobación del cliente (reunión o correo)" }, { status: 400 });
  return NextResponse.json({ clients: await setAmpliar(id, on, u.email, nota) });
}

export async function POST(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  if (!isCentroOwner(u.email)) return NextResponse.json({ error: "Solo la líder del Centro" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (b.action !== "restaurar") return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  const allowed = Object.keys(await getAmpliarClients());
  const db = supabaseAdmin();
  let q = db.from("client_reco_state").delete().not("client_id", "is", null);
  if (allowed.length) q = q.not("client_id", "in", `(${allowed.join(",")})`);
  const { data, error } = await q.select("client_id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, restaurados: (data ?? []).length });
}
