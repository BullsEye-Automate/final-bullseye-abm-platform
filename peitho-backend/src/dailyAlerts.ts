// Pedido explícito del usuario (05-11-2026): un correo diario con las
// reuniones que necesitan revisión humana — ya pasaron y siguen "Agendada"
// (los chequeos automáticos de recall.ts no lograron resolverlas solas),
// quedaron con el bot nunca admitido de la sala de espera, o nunca hicieron
// match (o quedaron con match ambiguo pendiente) contra el excel de metas.
// Se arma UN solo correo con las 3 secciones — si las 3 vienen vacías, no se
// manda nada (sin novedad, sin alerta).

import { pool } from './db';
import { INTERNAL_DOMAIN } from './routes/meetings';

const RESEND_API_URL = 'https://api.resend.com/emails';

function frontendBaseUrl(): string {
  return process.env.PEITHO_FRONTEND_BASE_URL ?? 'https://app.peithob2b.com';
}

// Lista separada por coma, con un default razonable — mismo patrón que
// PEITHO_FRONTEND_ORIGINS en app.ts (configurable sin tocar código si cambia
// quién debe recibir esto).
function alertRecipients(): string[] {
  const raw = process.env.PEITHO_DAILY_ALERTS_EMAILS;
  const list = raw
    ? raw.split(',').map((email) => email.trim()).filter(Boolean)
    : ['ihincapie@bullseye-abm.com', 'amadriz@bullseye-abm.com', 'jkarmy@bullseye-abm.com', 'rarredondo@bullseye-abm.com'];
  return list;
}

interface MeetingRow {
  id: string;
  start_time: string;
  empresa: string | null;
  contacto: string | null;
  cliente: string | null;
}

function formatFecha(value: string): string {
  return new Date(value).toLocaleString('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Santiago',
  });
}

function meetingLink(id: string): string {
  return `${frontendBaseUrl()}/reuniones/${id}`;
}

// Reuniones cuyo horario ya pasó y que siguen 'scheduled' — si los chequeos
// periódicos de recall.ts (cada 1-15 min) no las resolvieron solas para
// cuando corre este correo (una vez al día), es porque de verdad necesitan
// que alguien las mire: el caso más común es que nunca se les asignó un bot
// de Recall en absoluto (problema de sincronización del calendario), por eso
// se incluye esa columna.
async function getReunionesAgendadasVencidas(): Promise<(MeetingRow & { tiene_bot: boolean })[]> {
  const { rows } = await pool.query(
    `select m.id, m.start_time,
            coalesce(m.empresa_nombre, m.empresa_contraparte) as empresa,
            coalesce(m.contacto_nombre, m.contraparte) as contacto,
            c.name as cliente,
            (m.recall_bot_id is not null) as tiene_bot
     from meetings m
     left join clients c on c.id = m.client_id
     where m.status = 'scheduled'
       and m.start_time < now()
       and m.recurring_event_id is null
       and (m.meeting_url is not null or lower(m.empresa_contraparte) is distinct from $1)
     order by m.start_time asc`,
    [INTERNAL_DOMAIN]
  );
  return rows;
}

// 'bot_no_admitido' (migración 037) — acotado a los últimos 14 días para que
// el correo no crezca indefinidamente con casos ya viejos; si hace más de 2
// semanas que nadie lo revisó, ya es un problema de otro tipo (backlog), no
// algo para un correo diario de alertas.
async function getReunionesBotNoAdmitido(): Promise<MeetingRow[]> {
  const { rows } = await pool.query(
    `select m.id, m.start_time,
            coalesce(m.empresa_nombre, m.empresa_contraparte) as empresa,
            coalesce(m.contacto_nombre, m.contraparte) as contacto,
            c.name as cliente
     from meetings m
     left join clients c on c.id = m.client_id
     where m.status = 'bot_no_admitido'
       and m.start_time > now() - interval '14 days'
     order by m.start_time desc`
  );
  return rows;
}

// Sin match en absoluto (metas_sheet_match_id null) o match ambiguo pendiente
// de elegir (contacto_match_status='tentative', ver migración 030) — 24h de
// margen (recién ahí tiene sentido mirarlo, mismo criterio que
// checkStuckMeetingsAgainstMetasSheet) y acotado a 30 días para no repetir
// para siempre un caso que probablemente ya no va a matchear nunca.
async function getReunionesSinMatch(): Promise<(MeetingRow & { match_status: string })[]> {
  const { rows } = await pool.query(
    `select m.id, m.start_time,
            coalesce(m.empresa_nombre, m.empresa_contraparte) as empresa,
            coalesce(m.contacto_nombre, m.contraparte) as contacto,
            c.name as cliente,
            case when m.contacto_match_status = 'tentative' then 'match ambiguo, pendiente de elegir' else 'sin match' end as match_status
     from meetings m
     left join clients c on c.id = m.client_id
     where (m.metas_sheet_match_id is null or m.contacto_match_status = 'tentative')
       and m.start_time < now() - interval '24 hours'
       and m.start_time > now() - interval '30 days'
       and m.recurring_event_id is null
       and (m.meeting_url is not null or lower(m.empresa_contraparte) is distinct from $1)
     order by m.start_time desc`,
    [INTERNAL_DOMAIN]
  );
  return rows;
}

function renderRow(m: MeetingRow, extraCol?: string): string {
  return `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;">${formatFecha(m.start_time)}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;">${m.empresa ?? '—'}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;">${m.contacto ?? '—'}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;">${m.cliente ?? '—'}</td>
    ${extraCol !== undefined ? `<td style="padding:6px 10px;border-bottom:1px solid #eee;">${extraCol}</td>` : ''}
    <td style="padding:6px 10px;border-bottom:1px solid #eee;"><a href="${meetingLink(m.id)}" style="color:#251762;">Ver reunión</a></td>
  </tr>`;
}

function renderSection(title: string, intro: string, rows: string, extraHeader?: string): string {
  if (!rows) return '';
  return `
    <h2 style="color:#251762;font-size:16px;margin:24px 0 6px 0;">${title}</h2>
    <p style="color:#635C79;font-size:13px;margin:0 0 10px 0;">${intro}</p>
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead>
        <tr style="text-align:left;color:#948DA8;font-size:11px;text-transform:uppercase;">
          <th style="padding:6px 10px;">Fecha</th>
          <th style="padding:6px 10px;">Empresa</th>
          <th style="padding:6px 10px;">Contacto</th>
          <th style="padding:6px 10px;">Cliente</th>
          ${extraHeader !== undefined ? `<th style="padding:6px 10px;">${extraHeader}</th>` : ''}
          <th style="padding:6px 10px;"></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function sendEmail(subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[daily-alerts] Falta RESEND_API_KEY — no se pudo enviar el correo de alertas');
    return;
  }
  const from = process.env.PEITHO_ALERTS_FROM_EMAIL ?? 'alertas@peithob2b.com';

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Peitho <${from}>`,
      to: alertRecipients(),
      subject,
      html,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend respondió ${res.status} enviando el correo de alertas: ${await res.text()}`);
  }
}

export async function sendDailyMeetingAlerts(): Promise<void> {
  const [agendadasVencidas, botNoAdmitido, sinMatch] = await Promise.all([
    getReunionesAgendadasVencidas(),
    getReunionesBotNoAdmitido(),
    getReunionesSinMatch(),
  ]);

  const total = agendadasVencidas.length + botNoAdmitido.length + sinMatch.length;
  if (total === 0) {
    console.log('[daily-alerts] Nada para reportar hoy — no se envía correo');
    return;
  }

  const sectionAgendadas = renderSection(
    `Reuniones vencidas que siguen "Agendada" (${agendadasVencidas.length})`,
    'Ya pasó la hora de la reunión y los chequeos automáticos no las resolvieron solas — normalmente porque nunca se les asignó un bot de Recall (revisar la sincronización del calendario del ejecutivo).',
    agendadasVencidas.map((m) => renderRow(m, m.tiene_bot ? 'Con bot asignado' : 'Sin bot asignado')).join(''),
    'Bot'
  );

  const sectionBotNoAdmitido = renderSection(
    `Bot no admitido de la sala de espera (${botNoAdmitido.length})`,
    'El bot de Recall intentó unirse pero nadie lo dejó pasar de la sala de espera/lobby — no hay ninguna grabación posible para estas.',
    botNoAdmitido.map((m) => renderRow(m)).join('')
  );

  const sectionSinMatch = renderSection(
    `Sin match contra el excel de metas (${sinMatch.length})`,
    'No encontraron una fila en el excel de metas, o encontraron varias candidatas sin forma de elegir automáticamente — revisar en el detalle de la reunión.',
    sinMatch.map((m) => renderRow(m, m.match_status)).join(''),
    'Estado del match'
  );

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;">
      <p style="color:#948DA8;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin:0;">Peitho · Alertas diarias</p>
      <h1 style="color:#1C1530;font-size:20px;margin:4px 0 16px 0;">${total} reunion${total === 1 ? '' : 'es'} para revisar</h1>
      ${sectionAgendadas}
      ${sectionBotNoAdmitido}
      ${sectionSinMatch}
    </div>`;

  await sendEmail(`Peitho — ${total} reunion${total === 1 ? '' : 'es'} para revisar`, html);
  console.log(`[daily-alerts] Correo enviado con ${total} reunion(es) a revisar`);
}
