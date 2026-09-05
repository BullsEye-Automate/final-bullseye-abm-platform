import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { pool } from './db';
import { ANALISIS_SYSTEM_PROMPT, buildAnalisisUserMessage } from './prompts/analisisPostReunion';
import { resolveMeetingClientAndContact } from './metasSheet';
import { getClientKnowledgeBaseContext } from './knowledgeBase';

const DEEPGRAM_TIMEOUT_MS = 180_000;
// BullsEye vende en nombre de sus clientes (ej. presenta el producto de
// Webfleet a un prospecto de Webfleet), así que "la empresa que presta el
// servicio" en el prompt debe ser el cliente de BullsEye resuelto para esta
// reunión (Fase D) — "BullsEye" queda solo como fallback para reuniones sin
// cliente resuelto (ej. BullsEye vendiéndose a sí misma, que también es un
// cliente más según lo definido en Fase E).
const EMPRESA_CLIENTE_FALLBACK = 'BullsEye';
const PLAYBOOK = 'Ventas'; // fijo por ahora, per el diseño del prompt (doc sección 1)

interface DeepgramUtterance {
  speaker: number;
  transcript: string;
}

function getDeepgramApiKey(): string {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error('Falta la variable de entorno DEEPGRAM_API_KEY (ver .env.example)');
  return key;
}

// La extensión de Chrome sube .webm; el bot de Recall (Fase H) sube .mp3
// (media_shortcuts.audio_mixed, formato mp3) — Deepgram necesita el
// Content-Type real del archivo, no uno fijo.
const DEEPGRAM_CONTENT_TYPES: Record<string, string> = {
  '.webm': 'audio/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

async function transcribeAudio(filePath: string): Promise<any> {
  const audioBuffer = fs.readFileSync(filePath);
  const contentType = DEEPGRAM_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'audio/webm';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEEPGRAM_TIMEOUT_MS);

  try {
    const res = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-2&language=es&punctuate=true&diarize=true&utterances=true&smart_format=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${getDeepgramApiKey()}`,
          'Content-Type': contentType,
        },
        body: audioBuffer,
        signal: controller.signal,
      }
    );

    if (!res.ok) {
      throw new Error(`Deepgram respondió ${res.status}: ${await res.text()}`);
    }

    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Transcript nativo de Recall (Fase H) — reemplaza a Deepgram+heurística para
// las reuniones capturadas por el bot. Trae el nombre REAL de cada hablante
// (diarización por participante de la plataforma, no acústica), así que acá
// no hace falta adivinar quién es el ejecutivo — el prompt de análisis ya
// recibe por separado los nombres de ejecutivo/contraparte (columnas de
// `meetings`) y puede correlacionarlos él mismo contra estos nombres reales.
// Formato confirmado por la documentación de Recall: un array de segmentos
// por participante, cada uno con sus palabras.
interface RecallTranscriptSegment {
  participant?: { name?: string | null } | null;
  words?: Array<{ text?: string }>;
}

export function buildTranscriptFromRecall(segments: RecallTranscriptSegment[]): string {
  const lines: string[] = [];
  for (const segment of segments) {
    const name = segment.participant?.name?.trim() || 'Desconocido';
    const text = (segment.words ?? [])
      .map((word) => word.text ?? '')
      .join(' ')
      .trim();
    if (text) lines.push(`[${name}] ${text}`);
  }
  return lines.join('\n');
}

// Sin diarización distinguible, Deepgram no separa hablantes por rol — se asume
// que quien habla primero es el ejecutivo (quien inicia la llamada), como sugiere
// la arquitectura del prompt (ver docs/peitho_prompt_analisis_v1.md). Queda como
// fallback solo para la extensión de Chrome (nunca tiene transcript_text de
// Recall) — ver analyzeMeetingAudio.
function buildTranscriptText(deepgramResponse: any): string {
  const utterances: DeepgramUtterance[] = deepgramResponse?.results?.utterances ?? [];

  if (utterances.length === 0) {
    const flat = deepgramResponse?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
    return flat ? `[Transcripción]\n${flat}` : '';
  }

  let firstSpeaker: number | null = null;
  const lines: string[] = [];

  for (const utterance of utterances) {
    if (firstSpeaker === null) firstSpeaker = utterance.speaker;
    const label = utterance.speaker === firstSpeaker ? 'Ejecutivo' : 'Contraparte';
    lines.push(`[${label}] ${utterance.transcript}`);
  }

  return lines.join('\n');
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return 'Desconocida';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins} min ${secs} seg`;
}

async function runAnalysisPrompt(input: {
  transcript: string;
  ejecutivo: string;
  contraparte: string;
  fecha: string | null;
  durationSeconds: number | null;
  empresaCliente: string;
  baseConocimiento: string | null;
}): Promise<unknown> {
  const anthropic = new Anthropic();

  const userMessage = buildAnalisisUserMessage({
    empresaCliente: input.empresaCliente,
    ejecutivos: input.ejecutivo,
    contrapartes: input.contraparte,
    playbook: PLAYBOOK,
    fecha: input.fecha ? new Date(input.fecha).toLocaleString('es-CL') : 'Desconocida',
    duracion: formatDuration(input.durationSeconds),
    transcript: input.transcript,
    baseConocimiento: input.baseConocimiento,
  });

  const response = await anthropic.messages.create(
    {
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      thinking: { type: 'disabled' },
      system: [{ type: 'text', text: ANALISIS_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    },
    { timeout: 60_000 }
  );

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude no devolvió un bloque de texto');
  }

  // El prompt pide "sin markdown, sin backticks", pero el modelo a veces igual
  // envuelve la respuesta en ```json ... ``` — se limpia como red de seguridad.
  const cleaned = textBlock.text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`No se pudo parsear el JSON de Claude: ${textBlock.text.slice(0, 500)}`);
  }
}

export async function analyzeMeetingAudio(meetingId: string): Promise<void> {
  console.log(`[analysis] reunión ${meetingId}: buscando datos...`);

  // Gratis y sin tocar la API de Claude — mismo patrón que en el research
  // pre-reunión (ver preMeetingBrief.ts). No-op si la reunión ya tiene
  // client_id resuelto (ej. porque ya corrió el research antes).
  await resolveMeetingClientAndContact(meetingId);

  const { rows } = await pool.query(
    `select m.id, m.ejecutivo, m.contraparte, m.audio_path, m.transcript_text, m.start_time, m.client_id,
            c.name as cliente_bullseye
     from meetings m
     left join clients c on c.id = m.client_id
     where m.id = $1`,
    [meetingId]
  );
  const meeting = rows[0];
  if (!meeting) throw new Error(`Reunión ${meetingId} no encontrada`);

  // El bot de Recall (Fase H) ya deja el transcript armado (con nombres
  // reales) en transcript_text al bajar la grabación — ver webhooks.ts. Solo
  // se recurre a Deepgram sobre el audio si no hay transcript_text (flujo
  // viejo de la extensión de Chrome, que nunca lo tiene).
  let transcript: string;
  let durationSeconds: number | null = null;

  if (meeting.transcript_text) {
    console.log(`[analysis] reunión ${meetingId}: usando el transcript de Recall (sin Deepgram)...`);
    transcript = meeting.transcript_text;
  } else {
    if (!meeting.audio_path) throw new Error(`Reunión ${meetingId} no tiene audio_path ni transcript_text`);
    console.log(`[analysis] reunión ${meetingId}: transcribiendo con Deepgram...`);
    const deepgramResponse = await transcribeAudio(meeting.audio_path);
    transcript = buildTranscriptText(deepgramResponse);
    durationSeconds = deepgramResponse?.metadata?.duration ?? null;
  }

  if (!transcript) {
    throw new Error(`No se encontró transcripción para la reunión ${meetingId}`);
  }

  const baseConocimiento = await getClientKnowledgeBaseContext(meeting.client_id);

  console.log(`[analysis] reunión ${meetingId}: corriendo el prompt de análisis con Claude...`);
  const analysis = await runAnalysisPrompt({
    transcript,
    ejecutivo: meeting.ejecutivo ?? 'Ejecutivo',
    contraparte: meeting.contraparte ?? 'Contraparte',
    fecha: meeting.start_time,
    durationSeconds,
    empresaCliente: meeting.cliente_bullseye ?? EMPRESA_CLIENTE_FALLBACK,
    baseConocimiento,
  });

  await pool.query(`update meetings set analysis = $1, status = 'analyzed', updated_at = now() where id = $2`, [
    analysis,
    meetingId,
  ]);

  console.log(`[analysis] reunión ${meetingId}: análisis guardado, status=analyzed`);
}
