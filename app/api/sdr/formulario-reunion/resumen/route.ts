import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { generateMeetingSummary, type SummaryInput } from "@/lib/formularioReunion/summary";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

// Resumen enriquecido con IA para el mensaje de WhatsApp del Formulario de
// reuniones (lib/formularioReunion/summary.ts). Requiere sesión (middleware).
// No recibe correo ni teléfono del prospecto.
const FIELDS: (keyof SummaryInput)[] = [
  "cliente", "empresa", "pais", "contacto", "cargo", "origen", "industria", "comentario", "fecha_reunion",
];

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const input = Object.fromEntries(
    FIELDS.map((k) => [k, String(body[k] ?? "").slice(0, k === "comentario" ? 4000 : 300)])
  ) as SummaryInput;
  if (!input.empresa.trim() || !input.cliente.trim()) {
    return NextResponse.json({ error: "Faltan la empresa o el cliente" }, { status: 400 });
  }
  let userId: string | null = null;
  try {
    userId = (await supabaseServer().auth.getUser()).data.user?.id ?? null;
  } catch {}
  try {
    const ai = await generateMeetingSummary(input, userId);
    return NextResponse.json({ ai });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "No se pudo generar el resumen" }, { status: 502 });
  }
}
