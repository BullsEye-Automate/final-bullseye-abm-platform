import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { addShot, loadShots, ShotError } from "@/lib/meetingShots";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Pantallazos de una reunión subidos por el cliente (público, protegido por
// el feedback_token de la reunión: lo usan /encuesta/<token> y el formulario
// de /feedback-cliente/<token>, también embebido en el portal). El cliente ve
// y sube; borrar solo lo hace el equipo (Pulso ABM). Ver lib/meetingShots.ts.
async function meetingOf(token: string) {
  const { data } = await supabaseAdmin().from("meetings")
    .select("id, client_id, empresa, contacto_nombre, fecha_reunion").eq("feedback_token", token).maybeSingle();
  return data;
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const m = await meetingOf(params.token);
  if (!m) return NextResponse.json({ error: "Reunión no encontrada" }, { status: 404 });
  try {
    return NextResponse.json({ shots: await loadShots(String(m.id)) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const m = await meetingOf(params.token);
  if (!m) return NextResponse.json({ error: "Reunión no encontrada" }, { status: 404 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Falta la imagen" }, { status: 400 });
    const shot = await addShot({ meeting: m, bytes: Buffer.from(await file.arrayBuffer()), type: file.type, name: file.name, by: "cliente", source: "cliente" });
    return NextResponse.json({ shot });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: err instanceof ShotError ? 400 : 500 });
  }
}
