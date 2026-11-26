import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUserEmail } from "@/lib/academiaSdr/server/client";
import { addShot, deleteShot, loadShots, rereadShot, ShotError } from "@/lib/meetingShots";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Pulso ABM (vista interna) → Detalle de reuniones: pantallazos de cada
// reunión. El equipo sube los que el cliente manda por WhatsApp o correo, los
// ve (también los que subió el cliente), los borra o vuelve a leer con IA.
// GET ?meeting_id · POST multipart (meeting_id, file) · PATCH { meeting_id, id } (volver a leer) · DELETE ?meeting_id&id
const mid = (v: unknown) => String(v ?? "").replace(/@\d+$/, "");
async function meetingOf(id: string) {
  if (!id) return null;
  const { data } = await supabaseAdmin().from("meetings").select("id, client_id, empresa, contacto_nombre, fecha_reunion").eq("id", id).maybeSingle();
  return data;
}
const fail = (err: unknown) => NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: err instanceof ShotError ? 400 : 500 });

export async function GET(req: NextRequest) {
  if (!(await currentUserEmail())) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const id = mid(req.nextUrl.searchParams.get("meeting_id"));
  if (!id) return NextResponse.json({ error: "Falta meeting_id" }, { status: 400 });
  try { return NextResponse.json({ shots: await loadShots(id) }); } catch (err) { return fail(err); }
}

export async function POST(req: NextRequest) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  try {
    const form = await req.formData();
    const m = await meetingOf(mid(form.get("meeting_id")));
    if (!m) return NextResponse.json({ error: "Reunión no encontrada" }, { status: 404 });
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Falta la imagen" }, { status: 400 });
    const shot = await addShot({ meeting: m, bytes: Buffer.from(await file.arrayBuffer()), type: file.type, name: file.name, by: email, source: "equipo" });
    return NextResponse.json({ shot });
  } catch (err) { return fail(err); }
}

export async function PATCH(req: NextRequest) {
  if (!(await currentUserEmail())) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  try {
    const b = await req.json().catch(() => ({}));
    const m = await meetingOf(mid(b?.meeting_id));
    if (!m) return NextResponse.json({ error: "Reunión no encontrada" }, { status: 404 });
    return NextResponse.json({ shot: await rereadShot(m, String(b?.id ?? "")) });
  } catch (err) { return fail(err); }
}

export async function DELETE(req: NextRequest) {
  if (!(await currentUserEmail())) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  try {
    await deleteShot(mid(req.nextUrl.searchParams.get("meeting_id")), String(req.nextUrl.searchParams.get("id") ?? ""));
    return NextResponse.json({ ok: true });
  } catch (err) { return fail(err); }
}
