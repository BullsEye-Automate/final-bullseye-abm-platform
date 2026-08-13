import Anthropic from '@anthropic-ai/sdk';
import { pool } from './db';
import { PRE_REUNION_SYSTEM_PROMPT, buildPreReunionUserMessage, HistorialPeitho } from './prompts/preReunion';
import { resolveMeetingClientAndContact } from './metasSheet';

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
  contactoNombre: string | null;
  contactoCargo: string | null;
  contactoIndustria: string | null;
  clienteBullsEye: string | null;
  contactoLinkedinUrl: string | null;
}): Promise<unknown> {
  const anthropic = new Anthropic();

  const userMessage = buildPreReunionUserMessage({
    ejecutivo: input.ejecutivo,
    empresaContraparte: input.empresaContraparte,
    contactos: input.contactos,
    fecha: input.fecha ? new Date(input.fecha).toLocaleString('es-CL') : 'Desconocida',
    historial: input.historial,
    contactoNombre: input.contactoNombre,
    contactoCargo: input.contactoCargo,
    contactoIndustria: input.contactoIndustria,
    clienteBullsEye: input.clienteBullsEye,
    contactoLinkedinUrl: input.contactoLinkedinUrl,
  });

  const response = await anthropic.messages.create(
    {
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      thinking: { type: 'disabled' },
      system: [{ type: 'text', text: PRE_REUNION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      // Deja que el propio modelo busque en internet. Subido de 5 a 8 al
      // agregar experiencia laboral / icebreakers / competidores (Fase B) —
      // con 5 alcanzaba justo para empresa+contacto, y ahora hay 3 objetivos
      // de búsqueda más que compiten por el mismo presupuesto.
      // web_fetch (no web_search) es la que se usa cuando el ejecutivo pegó
      // a mano la URL de LinkedIn — solo trae URLs que ya están en la
      // conversación, así que la incluimos en el mensaje (ver
      // buildPreReunionUserMessage) para que pueda usarla.
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 },
      ],
      messages: [{ role: 'user', content: userMessage }],
    },
    // Subido de 3 a 4 min junto con el max_uses de arriba — más búsquedas
    // permitidas significa más llamadas de red + razonamiento secuencial
    // potencial dentro del mismo timeout.
    { timeout: 240_000 }
  );

  // Log de qué buscó realmente el modelo — sin esto, cuando el research
  // sale pobre (ver caso real: no encontró ni el LinkedIn de un contacto que
  // buscando a mano en Google aparece de inmediato) no hay forma de saber
  // si el modelo no buscó bien, o si buscó bien pero la web no tenía nada.
  for (const block of response.content) {
    if (block.type === 'server_tool_use' && block.name === 'web_search') {
      console.log(`[pre-brief] búsqueda: ${JSON.stringify((block.input as any)?.query ?? block.input)}`);
    } else if (block.type === 'web_search_tool_result') {
      const content = block.content as any;
      const count = Array.isArray(content) ? content.length : 0;
      console.log(`[pre-brief] resultado de búsqueda: ${count} resultado(s)${count === 0 ? ` — ${JSON.stringify(content)}` : ''}`);
    } else if (block.type === 'server_tool_use' && block.name === 'web_fetch') {
      console.log(`[pre-brief] web_fetch: ${JSON.stringify((block.input as any)?.url ?? block.input)}`);
    } else if (block.type === 'web_fetch_tool_result') {
      const content = block.content as any;
      const ok = content && content.type !== 'web_fetch_tool_result_error';
      console.log(`[pre-brief] resultado de web_fetch: ${ok ? 'ok' : `error — ${JSON.stringify(content)}`}`);
    }
  }

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

  // Gratis y sin tocar la API de Claude — se resuelve antes de gastar
  // búsquedas web adivinando datos que ya están registrados a mano.
  await resolveMeetingClientAndContact(meetingId);

  const { rows } = await pool.query(
    `select m.id, m.ejecutivo, m.contraparte, m.empresa_contraparte, m.start_time,
            m.contacto_nombre, m.contacto_cargo, m.contacto_industria, m.contacto_linkedin_url,
            c.name as cliente_bullseye
     from meetings m
     left join clients c on c.id = m.client_id
     where m.id = $1`,
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
      contactoNombre: meeting.contacto_nombre,
      contactoCargo: meeting.contacto_cargo,
      contactoIndustria: meeting.contacto_industria,
      clienteBullsEye: meeting.cliente_bullseye,
      contactoLinkedinUrl: meeting.contacto_linkedin_url,
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
