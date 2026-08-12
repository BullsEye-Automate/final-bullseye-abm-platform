import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { pool } from './db';
import { ANALISIS_SYSTEM_PROMPT, buildAnalisisUserMessage } from './prompts/analisisPostReunion';

const DEEPGRAM_TIMEOUT_MS = 180_000;
const EMPRESA_CLIENTE = 'BullsEye'; // fijo por ahora — Peitho no modela múltiples clientes todavía
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

async function transcribeAudio(filePath: string): Promise<any> {
  const audioBuffer = fs.readFileSync(filePath);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEEPGRAM_TIMEOUT_MS);

  try {
    const res = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-2&language=es&punctuate=true&diarize=true&utterances=true&smart_format=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${getDeepgramApiKey()}`,
          'Content-Type': 'audio/webm',
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

// Sin diarización distinguible, Deepgram no separa hablantes por rol — se asume
// que quien habla primero es el ejecutivo (quien inicia la llamada), como sugiere
// la arquitectura del prompt (ver docs/peitho_prompt_analisis_v1.md).
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
}): Promise<unknown> {
  const anthropic = new Anthropic();

  const userMessage = buildAnalisisUserMessage({
    empresaCliente: EMPRESA_CLIENTE,
    ejecutivos: input.ejecutivo,
    contrapartes: input.contraparte,
    playbook: PLAYBOOK,
    fecha: input.fecha ? new Date(input.fecha).toLocaleString('es-CL') : 'Desconocida',
    duracion: formatDuration(input.durationSeconds),
    transcript: input.transcript,
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

  try {
    return JSON.parse(textBlock.text);
  } catch {
    throw new Error(`No se pudo parsear el JSON de Claude: ${textBlock.text.slice(0, 500)}`);
  }
}

export async function analyzeMeetingAudio(meetingId: string): Promise<void> {
  console.log(`[analysis] reunión ${meetingId}: buscando datos...`);
  const { rows } = await pool.query(
    `select id, ejecutivo, contraparte, audio_path, start_time from meetings where id = $1`,
    [meetingId]
  );
  const meeting = rows[0];
  if (!meeting) throw new Error(`Reunión ${meetingId} no encontrada`);
  if (!meeting.audio_path) throw new Error(`Reunión ${meetingId} no tiene audio_path`);

  console.log(`[analysis] reunión ${meetingId}: transcribiendo con Deepgram...`);
  const deepgramResponse = await transcribeAudio(meeting.audio_path);
  const transcript = buildTranscriptText(deepgramResponse);
  const durationSeconds = deepgramResponse?.metadata?.duration ?? null;

  if (!transcript) {
    throw new Error(`Deepgram no devolvió transcripción para la reunión ${meetingId}`);
  }

  console.log(`[analysis] reunión ${meetingId}: corriendo el prompt de análisis con Claude...`);
  const analysis = await runAnalysisPrompt({
    transcript,
    ejecutivo: meeting.ejecutivo ?? 'Ejecutivo',
    contraparte: meeting.contraparte ?? 'Contraparte',
    fecha: meeting.start_time,
    durationSeconds,
  });

  await pool.query(`update meetings set analysis = $1, status = 'analyzed', updated_at = now() where id = $2`, [
    analysis,
    meetingId,
  ]);

  console.log(`[analysis] reunión ${meetingId}: análisis guardado, status=analyzed`);
}
