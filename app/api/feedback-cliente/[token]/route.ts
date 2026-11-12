import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { peithoFeedbackCoverage } from "@/lib/peithoFeedback";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const db = supabaseAdmin();

  // Buscar cliente por feedback_token
  const { data: client, error: clientError } = await db
    .from("clients")
    .select("id, name, logo_url")
    .eq("feedback_token", params.token)
    .single();

  if (clientError || !client) {
    return NextResponse.json({ error: "Link inválido o expirado" }, { status: 404 });
  }

  // Traer reuniones realizadas con su feedback
  const { data: meetings, error: meetingsError } = await db
    .from("meetings")
    .select("id, empresa, contacto_nombre, contacto_cargo, fecha_reunion, realizado, feedback_status, feedback_token, sdr_nombre")
    .eq("client_id", client.id)
    .eq("realizado", "Si")
    .order("fecha_reunion", { ascending: false });

  if (meetingsError) {
    return NextResponse.json({ error: meetingsError.message }, { status: 500 });
  }

  // Con Peitho activado, o si la reunión ya tiene análisis en Peitho, no se
  // pide feedback manual: queda como "peitho" (lib/peithoFeedback.ts)
  const list = meetings ?? [];
  const pending = list.filter((m) => m.feedback_status !== "con_feedback");
  const { enabled, covered } = await peithoFeedbackCoverage(db, client.id, pending);
  const out = list.map((m) =>
    m.feedback_status !== "con_feedback" && (enabled || covered.has(m.id)) ? { ...m, feedback_status: "peitho" } : m
  );
  return NextResponse.json({ client, meetings: out, peitho_enabled: enabled });
}
