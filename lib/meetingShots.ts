import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import { logAiUsage } from "@/lib/aiUsageLogger";

// Pantallazos de reuniones (pedido de BullsEye 25-nov-2026): los clientes
// comparten capturas (WhatsApp, correo, chat) con sus comentarios de una
// reunión. Los sube el cliente desde el link de feedback (o la encuesta de la
// reunión) y el equipo desde Pulso ABM → Detalle de reuniones. La IA lee cada
// pantallazo y deja un resumen + los comentarios del cliente, que se suman al
// feedback de la reunión (Resumen del feedback de Pulso ABM e Insights KAM).
//
// Sin migración: la imagen va al bucket privado "meeting-shots"
// (<meetings.id>/<id>.<ext>) y los datos, una fila por pantallazo en
// allo_response_cache: `meeting_shots:<meetings.id>:<id>` (5 años). Una fila
// por pantallazo evita que dos subidas a la vez se pisen.

const BUCKET = "meeting-shots";
const PREFIX = "meeting_shots:";
const TTL_MS = 5 * 365 * 86_400_000;
// Vercel acepta hasta 4,5 MB por request: el navegador achica la imagen antes de subirla
export const SHOT_MAX_BYTES = 4 * 1024 * 1024;
export const SHOT_MAX_PER_MEETING = 20;
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export type ShotReading = {
  status: "ok" | "error";
  resumen?: string;          // qué dice el cliente de la reunión, en 1-3 frases
  comentarios?: string[];    // comentarios del cliente, textuales o casi
  sentimiento?: "positivo" | "neutro" | "negativo" | "mixto";
  error?: string;
  at: string;
};
export type MeetingShot = {
  id: string;
  meetingId: string;
  path: string;
  name: string;
  type: string;
  size: number;
  at: string;
  by: string;                 // correo del equipo o "cliente"
  source: "cliente" | "equipo";
  ai?: ShotReading;
  url?: string;               // link firmado (1 h), solo al entregarlo
};

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const db = supabaseAdmin();
  const { data } = await db.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await db.storage.createBucket(BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw new Error(`No se pudo crear el bucket: ${error.message}`);
  }
  bucketReady = true;
}

const key = (meetingId: string, id: string) => `${PREFIX}${meetingId}:${id}`;

async function readRows(like: string): Promise<MeetingShot[]> {
  const out: MeetingShot[] = [];
  const db = supabaseAdmin();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("allo_response_cache").select("response").like("cache_key", like).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) if (r.response) out.push(r.response as MeetingShot);
    if (!data || data.length < 1000) break;
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export async function loadShots(meetingId: string, withUrls = true): Promise<MeetingShot[]> {
  const list = await readRows(`${PREFIX}${meetingId}:%`);
  return withUrls ? signShots(list) : list;
}

// Todos los pantallazos agrupados por reunión (son pocos: se leen de una vez)
export async function loadShotsByMeeting(meetingIds?: Iterable<string>): Promise<Map<string, MeetingShot[]>> {
  const only = meetingIds ? new Set([...meetingIds].map(String)) : null;
  const out = new Map<string, MeetingShot[]>();
  for (const s of await readRows(`${PREFIX}%`)) {
    if (only && !only.has(String(s.meetingId))) continue;
    out.set(String(s.meetingId), [...(out.get(String(s.meetingId)) ?? []), s]);
  }
  return out;
}

export async function signShots(list: MeetingShot[]): Promise<MeetingShot[]> {
  if (!list.length) return list;
  const { data } = await supabaseAdmin().storage.from(BUCKET).createSignedUrls(list.map((s) => s.path), 3600);
  const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return list.map((s) => ({ ...s, url: byPath.get(s.path) ?? undefined }));
}

type MeetingCtx = { id: string; client_id?: string | null; empresa?: string | null; contacto_nombre?: string | null; fecha_reunion?: string | null };

export async function addShot(input: {
  meeting: MeetingCtx; bytes: Buffer; type: string; name: string; by: string; source: "cliente" | "equipo"; userId?: string | null;
}): Promise<MeetingShot> {
  const ext = TYPES[input.type];
  if (!ext) throw new ShotError("Solo se aceptan imágenes PNG, JPG, WEBP o GIF.");
  if (input.bytes.length > SHOT_MAX_BYTES) throw new ShotError("La imagen pesa más de 4 MB.");
  const meetingId = String(input.meeting.id);
  const existing = await readRows(`${PREFIX}${meetingId}:%`);
  if (existing.length >= SHOT_MAX_PER_MEETING) throw new ShotError(`Esta reunión ya tiene ${SHOT_MAX_PER_MEETING} pantallazos.`);

  await ensureBucket();
  const id = randomUUID();
  const path = `${meetingId}/${id}.${ext}`;
  const { error: upErr } = await supabaseAdmin().storage.from(BUCKET).upload(path, input.bytes, { contentType: input.type, upsert: false });
  if (upErr) throw new Error(`No se pudo guardar la imagen: ${upErr.message}`);

  const shot: MeetingShot = {
    id, meetingId, path, name: (input.name || `pantallazo.${ext}`).slice(0, 120), type: input.type, size: input.bytes.length,
    at: new Date().toISOString(), by: input.by, source: input.source,
  };
  // La lectura con IA no frena la subida: si falla queda el pantallazo con el error
  shot.ai = await readShot(input.bytes, input.type, input.meeting, input.userId).catch((e) => ({ status: "error" as const, error: (e as Error).message.slice(0, 200), at: new Date().toISOString() }));
  await saveShot(shot);
  return (await signShots([shot]))[0];
}

async function saveShot(shot: MeetingShot) {
  const { url: _u, ...clean } = shot;
  const { error } = await supabaseAdmin().from("allo_response_cache").upsert(
    { cache_key: key(shot.meetingId, shot.id), response: clean, expires_at: new Date(Date.now() + TTL_MS).toISOString() },
    { onConflict: "cache_key" }
  );
  if (error) throw new Error(`No se pudo registrar el pantallazo: ${error.message}`);
}

export async function deleteShot(meetingId: string, shotId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data } = await db.from("allo_response_cache").select("response").eq("cache_key", key(meetingId, shotId)).maybeSingle();
  const shot = data?.response as MeetingShot | undefined;
  if (!shot) throw new ShotError("Pantallazo no encontrado.");
  await db.storage.from(BUCKET).remove([shot.path]).catch(() => null);
  await db.from("allo_response_cache").delete().eq("cache_key", key(meetingId, shotId));
}

// Vuelve a leer con IA un pantallazo cuya lectura falló
export async function rereadShot(meeting: MeetingCtx, shotId: string, userId?: string | null): Promise<MeetingShot> {
  const db = supabaseAdmin();
  const { data } = await db.from("allo_response_cache").select("response").eq("cache_key", key(String(meeting.id), shotId)).maybeSingle();
  const shot = data?.response as MeetingShot | undefined;
  if (!shot) throw new ShotError("Pantallazo no encontrado.");
  const file = await db.storage.from(BUCKET).download(shot.path);
  if (file.error || !file.data) throw new Error("No se pudo leer la imagen guardada.");
  const bytes = Buffer.from(await file.data.arrayBuffer());
  shot.ai = await readShot(bytes, shot.type, meeting, userId).catch((e) => ({ status: "error" as const, error: (e as Error).message.slice(0, 200), at: new Date().toISOString() }));
  await saveShot(shot);
  return (await signShots([shot]))[0];
}

export class ShotError extends Error {}

// Lectura con IA: qué dice el cliente de la reunión. Sin datos personales
// (teléfonos, correos, datos sensibles) en lo que se guarda.
async function readShot(bytes: Buffer, type: string, m: MeetingCtx, userId?: string | null): Promise<ShotReading> {
  const ctx = [m.empresa && `empresa ${m.empresa}`, m.contacto_nombre && `contacto ${m.contacto_nombre}`, m.fecha_reunion && `fecha ${m.fecha_reunion}`].filter(Boolean).join(", ");
  const res = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1200,
    tools: [{
      name: "entregar_lectura",
      description: "Entrega lo que el cliente comenta de la reunión en el pantallazo.",
      input_schema: {
        type: "object",
        properties: {
          resumen: { type: "string", description: "1 a 3 frases en español: qué opina o informa el cliente de BullsEye sobre esta reunión (calidad del prospecto, interés, próximos pasos). Si el pantallazo no trata de la reunión, dilo." },
          comentarios: { type: "array", items: { type: "string" }, description: "Comentarios del cliente sobre la reunión, textuales o casi (máx. 8). Sin teléfonos, correos ni datos personales sensibles." },
          sentimiento: { type: "string", enum: ["positivo", "neutro", "negativo", "mixto"] },
        },
        required: ["resumen", "comentarios", "sentimiento"],
      },
    }],
    tool_choice: { type: "tool", name: "entregar_lectura" },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: type as "image/png", data: bytes.toString("base64") } },
        { type: "text", text: `Este pantallazo lo compartió un cliente de BullsEye (agencia que agenda reuniones B2B para sus clientes) como feedback de una reunión${ctx ? ` (${ctx})` : ""}. Puede ser un chat de WhatsApp, un correo o notas. Extrae lo que el cliente dice de la reunión. No incluyas teléfonos, correos ni información personal sensible. Si no se puede leer, dilo en el resumen y deja comentarios vacío.` },
      ],
    }],
  });
  void logAiUsage({ userId, clientId: m.client_id ?? null, functionName: "pantallazo_reunion", model: CLAUDE_MODEL, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, metadata: { meeting_id: m.id } });
  const tool = res.content.find((c) => c.type === "tool_use") as { input?: any } | undefined;
  const inp = tool?.input ?? {};
  return {
    status: "ok",
    resumen: String(inp.resumen ?? "").slice(0, 800),
    comentarios: Array.isArray(inp.comentarios) ? inp.comentarios.map((x: unknown) => String(x).slice(0, 400)).slice(0, 8) : [],
    sentimiento: ["positivo", "neutro", "negativo", "mixto"].includes(inp.sentimiento) ? inp.sentimiento : undefined,
    at: new Date().toISOString(),
  };
}

// Texto para el feedback de la reunión (Pulso ABM / Insights KAM)
export function shotsText(list: MeetingShot[]): string {
  return list.filter((s) => s.ai?.status === "ok" && s.ai.resumen).map((s) => s.ai!.resumen!).join(" · ");
}
