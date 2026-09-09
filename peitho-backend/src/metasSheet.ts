// Lee el excel de metas (Google Sheets) donde el equipo registra cada reunión
// agendada a un cliente — de ahí sacamos nombre/cargo/industria del contacto y
// a qué cliente de BullsEye corresponde la reunión (ver CLAUDE.md, Fase A).
// A diferencia del research con web_search, esto no cuesta nada ni depende de
// que alguien haga clic — se resuelve automático la primera vez que se
// necesita (research pre-reunión o análisis post-reunión).

import { sheets_v4 } from 'googleapis';
import { getSheetsClientByEmail } from './google';
import { pool } from './db';

const REQUIRED_HEADERS = ['Contacto', 'Cargo', 'Industria', 'ID Reunión'];

interface SheetRow {
  cliente: string;
  clienteId: string | null;
  empresa: string;
  contacto: string;
  cargo: string;
  industria: string;
  fechaReunion: string;
  idReunion: string;
}

interface MetasCache {
  tabTitle: string;
  rows: SheetRow[];
  fetchedAt: number;
}

let cache: MetasCache | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

// La hoja tiene ~15-20 tabs distintos (comisiones, prospección, OKRs, etc.) —
// en vez de hardcodear el nombre exacto del tab (frágil, se puede renombrar),
// se detecta el que tiene las columnas que necesitamos.
// Sin timeout explícito, una llamada a la API de Sheets que se cuelga (red
// lenta, algo raro del lado de Google) deja la promesa pendiente para
// siempre — y con eso, cualquier flujo que dependa de resolveMeetingClientAndContact
// (research, análisis post-reunión, scheduleRecallBotForMeeting) se cuelga
// entero. Mismo patrón que ya usa calendarSync.ts para events.list/events.watch.
const SHEETS_TIMEOUT_MS = 15_000;

async function findReunionesTabTitle(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<string> {
  const { data } = await sheets.spreadsheets.get(
    { spreadsheetId, fields: 'sheets.properties.title' },
    { timeout: SHEETS_TIMEOUT_MS }
  );
  const titles = (data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((title): title is string => Boolean(title));

  for (const title of titles) {
    const { data: headerData } = await sheets.spreadsheets.values.get(
      {
        spreadsheetId,
        range: `'${title}'!1:1`,
      },
      { timeout: SHEETS_TIMEOUT_MS }
    );
    const header = (headerData.values?.[0] ?? []).map((h) => String(h).trim());
    if (REQUIRED_HEADERS.every((required) => header.includes(required))) {
      return title;
    }
  }

  throw new Error(
    `No se encontró ninguna hoja con las columnas esperadas (${REQUIRED_HEADERS.join(', ')}) en el spreadsheet ${spreadsheetId}`
  );
}

async function loadReunionesRows(forceRefresh = false): Promise<SheetRow[]> {
  if (!forceRefresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rows;
  }

  const spreadsheetId = process.env.METAS_SHEET_ID;
  const accountEmail = process.env.METAS_SHEET_GOOGLE_ACCOUNT_EMAIL;
  if (!spreadsheetId || !accountEmail) {
    throw new Error('Faltan METAS_SHEET_ID o METAS_SHEET_GOOGLE_ACCOUNT_EMAIL en las variables de entorno');
  }

  const { sheets } = await getSheetsClientByEmail(accountEmail);
  const tabTitle = cache?.tabTitle ?? (await findReunionesTabTitle(sheets, spreadsheetId));

  const { data } = await sheets.spreadsheets.values.get(
    {
      spreadsheetId,
      range: `'${tabTitle}'!A:W`,
    },
    { timeout: SHEETS_TIMEOUT_MS }
  );

  const values = data.values ?? [];
  const header = (values[0] ?? []).map((h) => String(h).trim());
  const col = (name: string) => header.indexOf(name);

  const rows: SheetRow[] = values.slice(1).map((raw) => ({
    cliente: String(raw[col('Cliente')] ?? '').trim(),
    clienteId: raw[col('ID Cliente')] ? String(raw[col('ID Cliente')]).trim() : null,
    empresa: String(raw[col('Empresa')] ?? '').trim(),
    contacto: String(raw[col('Contacto')] ?? '').trim(),
    cargo: String(raw[col('Cargo')] ?? '').trim(),
    industria: String(raw[col('Industria')] ?? '').trim(),
    fechaReunion: String(raw[col('Fecha de la reunión')] ?? '').trim(),
    idReunion: String(raw[col('ID Reunión')] ?? '').trim(),
  }));

  cache = { tabTitle, rows, fetchedAt: Date.now() };
  console.log(`[metas-sheet] ${rows.length} filas cargadas de la hoja "${tabTitle}"`);
  return rows;
}

function normalizeCompanyName(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Bug real (08-09-2026, Noventiq): empresa_contraparte se guarda como el
// DOMINIO del correo del invitado (ej. "noventiq.com", desde
// extractContraparte en calendarSync.ts — es lo único disponible en el
// evento de Calendar), pero el excel de metas tiene el nombre "limpio" de la
// empresa (ej. "Noventiq", sin TLD). El match exacto entre
// normalizeCompanyName de ambos nunca calzaba en ese caso — la fila existía
// en el excel pero nunca se encontraba. Esto quita el TLD como fallback,
// solo si el match exacto no encontró nada (para no romper casos donde el
// nombre real de la empresa SÍ incluye un TLD, ej. "Trabajando.com", que ya
// venía matcheando bien con el exacto).
function stripDomainSuffix(domain: string): string {
  return domain.replace(/\.(com|cl|co|io|net|org|mx|pe|ar|us|latam|la|cloud|app)$/i, '');
}

// Formato observado en la hoja: d/m/yyyy (a veces yy de 2 dígitos). Es una
// hoja mantenida a mano — hay filas con fechas claramente mal tipeadas, así
// que esto es solo un desempate entre candidatos, no la condición principal.
function parseSheetDate(raw: string): Date | null {
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  let year = parseInt(match[3], 10);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

// El excel se llena en hora de Chile (fecha "de calendario", sin huso
// horario) pero start_time de una reunión viene en UTC — comparar el día
// crudo de start_time contra la fecha del excel es el mismo tipo de bug de
// huso horario que ya mordió una vez en esta investigación (una reunión de
// las 20:xx UTC es de otro día en Chile). Intl.DateTimeFormat con la zona
// horaria de Chile resuelve el offset correcto (-3 o -4) sin hardcodearlo,
// incluyendo el cambio de horario de verano.
const MEETING_TIMEZONE = 'America/Santiago';

function chileDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MEETING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function sheetDateKey(raw: string): string | null {
  const parsed = parseSheetDate(raw);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

// Filtro por empresa/prospecto (con el mismo fallback de stripDomainSuffix
// de siempre) dentro de un conjunto ya acotado de filas candidatas. Solo
// devuelve una fila si el filtro deja exactamente una — con más de una no
// hay forma de saber cuál es sin adivinar.
function desambiguarPorEmpresa(candidatos: SheetRow[], empresaContraparte: string | null): SheetRow | null {
  const empresaNorm = normalizeCompanyName(empresaContraparte);
  if (!empresaNorm) return null;

  let match = candidatos.filter((row) => normalizeCompanyName(row.empresa) === empresaNorm);
  if (match.length === 0) {
    const empresaSinTld = stripDomainSuffix(empresaNorm);
    if (empresaSinTld !== empresaNorm) {
      match = candidatos.filter((row) => normalizeCompanyName(row.empresa) === empresaSinTld);
    }
  }
  return match.length === 1 ? match[0] : null;
}

// Fallback (09-09-2026): matching viejo, por empresa primero y fecha más
// cercana como desempate — para cuando la reunión no tiene ningún candidato
// por fecha exacta (típicamente porque el excel tiene la fecha mal tipeada,
// ver "es una hoja mantenida a mano" más abajo). Sin esto, un typo de fecha
// en el excel dejaría la reunión sin matchear de plano, cuando antes sí
// encontraba la fila por empresa.
function matchMeetingRowPorEmpresaYFechaMasCercana(
  rows: SheetRow[],
  meeting: { empresa_contraparte: string | null; start_time: string | null }
): SheetRow | null {
  const empresaNorm = normalizeCompanyName(meeting.empresa_contraparte);
  if (!empresaNorm) return null;

  let candidatos = rows.filter((row) => normalizeCompanyName(row.empresa) === empresaNorm);
  if (candidatos.length === 0) {
    const empresaSinTld = stripDomainSuffix(empresaNorm);
    if (empresaSinTld !== empresaNorm) {
      candidatos = rows.filter((row) => normalizeCompanyName(row.empresa) === empresaSinTld);
    }
  }
  if (candidatos.length === 0) return null;
  if (candidatos.length === 1) return candidatos[0];

  const meetingDate = meeting.start_time ? new Date(meeting.start_time) : null;
  if (!meetingDate) return candidatos[0];

  let mejor: SheetRow | null = null;
  let mejorDiff = Infinity;
  for (const row of candidatos) {
    const rowDate = parseSheetDate(row.fechaReunion);
    if (!rowDate) continue;
    const diff = Math.abs(rowDate.getTime() - meetingDate.getTime());
    if (diff < mejorDiff) {
      mejorDiff = diff;
      mejor = row;
    }
  }
  return mejor ?? candidatos[0];
}

// Pedido explícito del usuario (09-09-2026): matchear primero por fecha
// (dato confiable — viene de Calendar, no de una extracción de dominio que
// puede fallar como ya pasó con CCHC/Paula Rios) y usar la empresa solo
// para desambiguar entre las reuniones agendadas ese mismo día para
// clientes distintos — al revés del orden anterior (empresa primero, fecha
// como desempate). Como beneficio extra, esto también puede matchear
// reuniones donde empresa_contraparte quedó null (ver caso del Zoom sin
// asistentes) si ese día solo hay una reunión en el excel.
function matchMeetingRow(
  rows: SheetRow[],
  meeting: { empresa_contraparte: string | null; start_time: string | null }
): SheetRow | null {
  if (meeting.start_time) {
    const meetingDateKey = chileDateKey(new Date(meeting.start_time));
    const candidatosPorFecha = rows.filter((row) => sheetDateKey(row.fechaReunion) === meetingDateKey);

    if (candidatosPorFecha.length === 1) return candidatosPorFecha[0];
    if (candidatosPorFecha.length > 1) {
      return desambiguarPorEmpresa(candidatosPorFecha, meeting.empresa_contraparte);
    }
  }

  // Sin ningún candidato con esa fecha exacta (o sin start_time) — probable
  // typo de fecha en el excel, cae al matching viejo por empresa.
  return matchMeetingRowPorEmpresaYFechaMasCercana(rows, meeting);
}

async function findOrCreateClient(name: string, externalId: string | null): Promise<string> {
  const trimmedName = name.trim();
  const { rows: existing } = await pool.query(
    `select id, external_id from clients where lower(name) = lower($1) or ($2::text is not null and external_id = $2) limit 1`,
    [trimmedName, externalId]
  );
  if (existing[0]) {
    if (externalId && !existing[0].external_id) {
      await pool.query(`update clients set external_id = $1 where id = $2`, [externalId, existing[0].id]);
    }
    return existing[0].id;
  }

  const { rows } = await pool.query(`insert into clients (name, external_id) values ($1, $2) returning id`, [
    trimmedName,
    externalId,
  ]);
  return rows[0].id;
}

// Best-effort: si no hay match o la integración no está configurada todavía,
// no rompe el research/análisis — simplemente esos campos quedan vacíos
// (mismo criterio que ya usamos: mejor vacío que un dato falso).
export async function resolveMeetingClientAndContact(meetingId: string): Promise<void> {
  const { rows } = await pool.query(
    `select id, empresa_contraparte, start_time, client_id from meetings where id = $1`,
    [meetingId]
  );
  const meeting = rows[0];
  if (!meeting || meeting.client_id) return;

  try {
    const sheetRows = await loadReunionesRows();
    const match = matchMeetingRow(sheetRows, meeting);
    if (!match) {
      console.log(
        `[metas-sheet] reunión ${meetingId}: sin match en el excel de metas (empresa="${meeting.empresa_contraparte}")`
      );
      return;
    }

    const clientId = match.cliente ? await findOrCreateClient(match.cliente, match.clienteId) : null;

    await pool.query(
      `update meetings set
         client_id = $1,
         contacto_nombre = coalesce(nullif($2, ''), contacto_nombre),
         contacto_cargo = coalesce(nullif($3, ''), contacto_cargo),
         contacto_industria = coalesce(nullif($4, ''), contacto_industria),
         metas_sheet_match_id = nullif($5, ''),
         empresa_nombre = coalesce(nullif($6, ''), empresa_nombre),
         updated_at = now()
       where id = $7`,
      [clientId, match.contacto, match.cargo, match.industria, match.idReunion, match.empresa, meetingId]
    );
    console.log(
      `[metas-sheet] reunión ${meetingId}: match encontrado (cliente="${match.cliente}", contacto="${match.contacto}")`
    );
  } catch (error) {
    console.error(`[metas-sheet] reunión ${meetingId}: error resolviendo cliente/contacto`, error);
  }
}
