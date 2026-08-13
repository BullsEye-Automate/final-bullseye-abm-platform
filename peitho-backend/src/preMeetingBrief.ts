import Anthropic from '@anthropic-ai/sdk';
import { pool } from './db';
import { PRE_REUNION_SYSTEM_PROMPT, buildPreReunionUserMessage, HistorialPeitho } from './prompts/preReunion';

async function findHistorial(
  contraparte: string | null,
  empresaContraparte: string | null
): Promise<HistorialPeitho | null> {
  if (!contraparte || !empresaContraparte) return null;

  const { rows } = await pool.query(
    `select analysis from meetings
     where contraparte = $1 and empresa_contraparte = $2
       and status = 'analyzed' and analysis is not null
     order by start_time desc
     limit 1`,
    [contraparte, empresaContraparte]
  );

  const analysis = rows[0]?.analysis;
  if (!analysis) return null;

  return {
    // Solo los compromisos que no se marcaron como completados (ver
    // docs/peitho_prompt_pre_reunion_v1.md, sección 3).
    compromisos: (analysis.compromisos ?? []).filter((c: any) => !c?.completado),
    temas_pendientes: analysis.temas_pendientes ?? [],
    objeciones: analysis.objeciones ?? [],
    tiempo_decision: analysis.tiempo_decision ?? null,
  };
}

async function runPreReunionPrompt(input: {
  ejecutivo: string;
  empresaContraparte: string;
  contactos: string;
  fecha: string | null;
  historial: HistorialPeitho | null;
}): Promise<unknown> {
  const anthropic = new Anthropic();

  const userMessage = buildPreReunionUserMessage({
    ejecutivo: input.ejecutivo,
    empresaContraparte: input.empresaContraparte,
    contactos: input.contactos,
    fecha: input.fecha ? new Date(input.fecha).toLocaleString('es-CL') : 'Desconocida',
    historial: input.historial,
  });

  const response = await anthropic.messages.create(
    {
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      thinking: { type: 'disabled' },
      system: [{ type: 'text', text: PRE_REUNION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      // Deja que el propio modelo busque en internet — máx. 3 búsquedas para
      // acotar el costo (esto es "búsqueda web básica", no research exhaustivo).
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: userMessage }],
    },
    { timeout: 90_000 }
  );

  // Con la herramienta de búsqueda, la respuesta trae varios bloques
  // intercalados (texto, resultados de búsqueda) — el JSON final es el
  // último bloque de texto, no necesariamente content[0].
  const textBlocks = response.content.filter((block) => block.type === 'text');
  const lastText = textBlocks[textBlocks.length - 1];
  if (!lastText || lastText.type !== 'text') {
    throw new Error('Claude no devolvió un bloque de texto final');
  }

  const cleaned = lastText.text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`No se pudo parsear el JSON del brief: ${lastText.text.slice(0, 500)}`);
  }
}

// La ruta ya marcó pre_brief_status='running' antes de llamar acá (ver
// routes/meetings.ts) — esta función hace el trabajo lento y deja el
// resultado final (o el estado 'failed').
export async function generatePreMeetingBrief(meetingId: string): Promise<void> {
  console.log(`[pre-brief] reunión ${meetingId}: buscando datos...`);
  const { rows } = await pool.query(
    `select id, ejecutivo, contraparte, empresa_contraparte, start_time from meetings where id = $1`,
    [meetingId]
  );
  const meeting = rows[0];
  if (!meeting) throw new Error(`Reunión ${meetingId} no encontrada`);

  try {
    const historial = await findHistorial(meeting.contraparte, meeting.empresa_contraparte);

    console.log(`[pre-brief] reunión ${meetingId}: investigando con Claude (web search)...`);
    const brief = await runPreReunionPrompt({
      ejecutivo: meeting.ejecutivo ?? 'Ejecutivo',
      empresaContraparte: meeting.empresa_contraparte ?? 'Desconocida',
      contactos: meeting.contraparte ?? 'Desconocido',
      fecha: meeting.start_time,
      historial,
    });

    await pool.query(
      `update meetings set pre_brief = $1, pre_brief_status = 'done', updated_at = now() where id = $2`,
      [brief, meetingId]
    );
    console.log(`[pre-brief] reunión ${meetingId}: brief guardado`);
  } catch (error) {
    await pool.query(`update meetings set pre_brief_status = 'failed', updated_at = now() where id = $1`, [
      meetingId,
    ]);
    throw error;
  }
}
