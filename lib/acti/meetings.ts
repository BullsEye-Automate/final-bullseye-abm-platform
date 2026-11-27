import type { SupabaseClient } from "@supabase/supabase-js";
import { isPeithoEnabled } from "@/lib/peitho";
import { loadPeithoPast, matchPeithoMeetings } from "@/lib/peithoFeedback";
import { canSeePulsoView, type ActiPlan } from "@/lib/acti/plans";
import { chileToday } from "@/lib/acti/home";

// ACTI · Reuniones y feedback. Las reuniones salen de la planilla de reuniones
// (tabla `meetings`, la misma de Pulso ABM y Células SDR). Como ya están
// agendadas, el socio ve nombre, cargo, correo y teléfono del contacto
// (decisión de BullsEye 27-nov-2026). El análisis es el de Peitho (planes con
// Peitho, desde Crece) y el feedback del socio se guarda en la encuesta de
// siempre (meeting_feedback) + acti_meeting_feedback (lo propio de ACTI).

export type ActiFeedback = {
  realizada: boolean;
  perfil_rating: number | null;
  perfil_ok: boolean | null;
  oportunidad: "si" | "no" | "aun_no" | "otra_reunion" | null;
  comentario: string | null;
  disputa: "en_revision" | "cobrar" | "no_cobrar" | null;
};

export type ActiMeeting = {
  id: string;
  company: string;
  date: string | null;
  time: string | null;
  status: "proxima" | "realizada" | "no_show" | "por_confirmar" | "reagendada";
  contact: { name: string | null; title: string | null; email: string | null; phone: string | null };
  peithoId: string | null;
  feedback: ActiFeedback | null;
  surveyDone: boolean;   // ya tiene la encuesta de siempre (meeting_feedback)
};

type Row = {
  id: string; empresa: string; contacto_nombre: string | null; contacto_cargo: string | null; correo: string | null; telefono: string | null;
  fecha_reunion: string | null; hora: string | null; realizado: string | null; feedback_status: string | null;
};

export function meetingStatus(realizado: string | null, fecha: string | null, today: string): ActiMeeting["status"] {
  if (realizado === "Si") return "realizada";
  if (realizado === "No") return "no_show";
  if (realizado === "Reagendar") return fecha && fecha >= today ? "proxima" : "reagendada";
  return fecha && fecha >= today ? "proxima" : "por_confirmar";
}

export async function loadActiMeetings(db: SupabaseClient, clientId: string, plan: ActiPlan): Promise<{ meetings: ActiMeeting[]; peitho: "on" | "off_plan" | "off_client" }> {
  const today = chileToday();
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await db
    .from("meetings")
    .select("id, empresa, contacto_nombre, contacto_cargo, correo, telefono, fecha_reunion, hora, realizado, feedback_status")
    .eq("client_id", clientId)
    .gte("fecha_reunion", since)
    .order("fecha_reunion", { ascending: false })
    .limit(500);
  const rows = (data ?? []) as Row[];

  const ids = rows.map((r) => r.id);
  const { data: fb } = ids.length ? await db.from("acti_meeting_feedback").select("meeting_id, realizada, perfil_rating, perfil_ok, oportunidad, comentario, disputa").in("meeting_id", ids) : { data: [] };
  const fbById = new Map(((fb ?? []) as (ActiFeedback & { meeting_id: string })[]).map((f) => [f.meeting_id, f]));

  // Peitho: solo planes que lo incluyen y clientes con Peitho activado
  let peitho: "on" | "off_plan" | "off_client" = "off_plan";
  let peithoIds = new Map<string, string>();
  if (canSeePulsoView(plan, "peitho")) {
    peitho = (await isPeithoEnabled(db, clientId)) ? "on" : "off_client";
    if (peitho === "on") {
      const past = rows.filter((r) => r.fecha_reunion && r.fecha_reunion <= today);
      const list = past.length ? await loadPeithoPast(db, clientId) : null;
      if (list) peithoIds = new Map([...matchPeithoMeetings(list, past)].map(([k, v]) => [k, v.id]));
    }
  }

  const meetings = rows.map((r) => {
    const f = fbById.get(r.id);
    return {
      id: r.id,
      company: r.empresa,
      date: r.fecha_reunion,
      time: r.hora,
      status: meetingStatus(r.realizado, r.fecha_reunion, today),
      contact: { name: r.contacto_nombre, title: r.contacto_cargo, email: r.correo, phone: r.telefono },
      peithoId: peithoIds.get(r.id) ?? null,
      feedback: f ? { realizada: f.realizada, perfil_rating: f.perfil_rating, perfil_ok: f.perfil_ok, oportunidad: f.oportunidad, comentario: f.comentario, disputa: f.disputa } : null,
      surveyDone: r.feedback_status === "con_feedback",
    };
  });
  // Próximas: de la más cercana a la más lejana
  meetings.sort((a, b) =>
    a.status === "proxima" && b.status === "proxima" ? (a.date ?? "").localeCompare(b.date ?? "") : (b.date ?? "").localeCompare(a.date ?? "")
  );
  return { meetings, peitho };
}

const OPORTUNIDAD_A_PROPUESTA: Record<string, string> = { si: "Si", no: "No", aun_no: "No aún", otra_reunion: "Falta otra reunión" };

export class ActiFeedbackError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function saveActiFeedback(
  db: SupabaseClient,
  clientId: string,
  meetingId: string,
  input: Record<string, unknown>,
  by: string
) {
  const { data: m } = await db
    .from("meetings")
    .select("id, client_id, fecha_reunion, realizado, feedback_status")
    .eq("id", meetingId)
    .maybeSingle();
  if (!m || m.client_id !== clientId) throw new ActiFeedbackError("Reunión no encontrada", 404);
  if (m.fecha_reunion && m.fecha_reunion > chileToday()) throw new ActiFeedbackError("La reunión aún no ocurre.");
  if (typeof input.realizada !== "boolean") throw new ActiFeedbackError("Indica si la reunión se realizó.");

  const realizada = input.realizada;
  const rating = typeof input.perfil_rating === "number" && input.perfil_rating >= 1 && input.perfil_rating <= 5 ? Math.round(input.perfil_rating) : null;
  const perfilOk = typeof input.perfil_ok === "boolean" ? input.perfil_ok : null;
  const oportunidad = typeof input.oportunidad === "string" && input.oportunidad in OPORTUNIDAD_A_PROPUESTA ? input.oportunidad : null;
  const comentario = typeof input.comentario === "string" ? input.comentario.trim().slice(0, 1000) || null : null;

  const { data: prev } = await db.from("acti_meeting_feedback").select("disputa").eq("meeting_id", meetingId).maybeSingle();
  // El socio dice que no se realizó y la planilla dice que sí → en revisión
  // (no se cobra hasta que el equipo lo resuelva). Una disputa ya resuelta no
  // se reabre con un nuevo guardado.
  let disputa = (prev?.disputa as ActiFeedback["disputa"]) ?? null;
  if (!realizada && m.realizado === "Si" && !disputa) disputa = "en_revision";
  if (realizada && disputa === "en_revision") disputa = null;

  const { error } = await db.from("acti_meeting_feedback").upsert(
    {
      meeting_id: meetingId,
      client_id: clientId,
      realizada,
      perfil_rating: realizada ? rating : null,
      perfil_ok: realizada ? perfilOk : null,
      oportunidad: realizada ? oportunidad : null,
      comentario,
      disputa,
      ...(disputa === "en_revision" && prev?.disputa !== "en_revision" ? { disputa_por: by, disputa_at: new Date().toISOString() } : {}),
      submitted_by: by,
    },
    { onConflict: "meeting_id" }
  );
  if (error) throw new Error(error.message);

  // La encuesta de siempre (la que leen Pulso ABM, el resumen de feedback y los
  // Insights KAM). Solo si aún no tiene una: no se pisa lo que ya respondió.
  if (realizada && m.feedback_status !== "con_feedback" && (rating || perfilOk !== null || oportunidad)) {
    const { error: e2 } = await db.from("meeting_feedback").insert({
      meeting_id: meetingId,
      calificacion: rating ? rating * 2 : null,              // escala 1–5 → 1–10
      contacto_calificado: perfilOk,
      propuesta_comercial: oportunidad ? OPORTUNIDAD_A_PROPUESTA[oportunidad] : null,
      comentarios_adicionales: comentario ? `[Socio ACTI] ${comentario}` : "[Socio ACTI]",
    });
    if (!e2) await db.from("meetings").update({ feedback_status: "con_feedback" }).eq("id", meetingId);
    else if (e2.code !== "23505") console.error("acti feedback → meeting_feedback:", e2.message);
  }
  return { disputa };
}

// Resolución de una disputa por el equipo (cobrar / no cobrar)
export async function resolveDispute(db: SupabaseClient, meetingId: string, decision: "cobrar" | "no_cobrar", by: string) {
  const { data, error } = await db
    .from("acti_meeting_feedback")
    .update({ disputa: decision, disputa_por: by, disputa_at: new Date().toISOString() })
    .eq("meeting_id", meetingId)
    .not("disputa", "is", null)
    .select("meeting_id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new ActiFeedbackError("La reunión no tiene una revisión pendiente", 404);
}
