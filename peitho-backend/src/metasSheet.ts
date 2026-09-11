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
  pais: string;
  // Ejecutivo del cliente de BullsEye (ej. CCHC) que toma la reunión — solo
  // se rellena cuando ese cliente tiene varios ejecutivos y pide asignarlos
  // por nombre, así que viene vacío la mayoría de las filas.
  salesManager: string;
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
    pais: String(raw[col('País')] ?? '').trim(),
    salesManager: String(raw[col('Sales Manager')] ?? '').trim(),
    idReunion: String(raw[col('ID Reunión')] ?? '').trim(),
  }));

  cache = { tabTitle, rows, fetchedAt: Date.now() };
  console.log(`[metas-sheet] ${rows.length} filas cargadas de la hoja "${tabTitle}"`);
  return rows;
}

// Bug real (11-09-2026, "Ecológica"/Umine): no sacaba tildes — "EcoLógica"
// (excel) normalizaba a "ecológica", mientras que "ecologica.cl" (dominio,
// sin acentos) normalizaba a "ecologica" — nunca calzaban exacto por un solo
// carácter, y encima fuzzyCompanyKey (abajo) borraba la "ó" en vez de
// convertirla a "o", corrompiendo también el fallback difuso ("ecolgica",
// con una letra de menos). Mismo patrón de normalize('NFKD') + quitar marcas
// diacríticas que ya usa sanitizeForStoragePath en knowledgeBase.ts.
function normalizeCompanyName(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
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

// Cada fila del excel se agenda y se registra en la hora LOCAL del país de
// esa reunión (columna "País" — Chile, Perú, México, Colombia, ...), no
// necesariamente en hora de Chile. Bug real (09-09-2026): la primera
// versión de este archivo convertía siempre a hora de Chile sin mirar el
// país de la fila — para una reunión de un país con offset distinto (ej.
// Colombia, UTC-5 vs. los UTC-3/-4 de Chile) eso puede cruzar la medianoche
// distinto y dar el día de calendario equivocado, el mismo tipo de bug de
// huso horario que ya mordió antes en esta investigación. Por eso la
// comparación de fecha se hace por fila, resolviendo la zona horaria según
// el país de ESA fila, no una fija para toda la hoja.
const DEFAULT_TIMEZONE = 'America/Santiago'; // fallback si el país no está en el mapa o viene vacío — Chile es la mayoría de las filas

const COUNTRY_TIMEZONES: Record<string, string> = {
  chile: 'America/Santiago',
  peru: 'America/Lima',
  perú: 'America/Lima',
  mexico: 'America/Mexico_City',
  méxico: 'America/Mexico_City',
  colombia: 'America/Bogota',
  argentina: 'America/Argentina/Buenos_Aires',
  ecuador: 'America/Guayaquil',
  panama: 'America/Panama',
  panamá: 'America/Panama',
  'estados unidos': 'America/New_York',
  usa: 'America/New_York',
};

function timezoneForCountry(pais: string | null | undefined): string {
  const key = (pais ?? '').trim().toLowerCase();
  if (!key) return DEFAULT_TIMEZONE;
  return COUNTRY_TIMEZONES[key] ?? DEFAULT_TIMEZONE;
}

function dateKeyInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function sheetDateKey(raw: string): string | null {
  const parsed = parseSheetDate(raw);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

// ¿La fecha de esta fila (en la zona horaria de SU país) es el mismo día de
// calendario que start_time de la reunión? No hay una única "fecha de la
// reunión" válida para toda la hoja — depende del país de cada fila.
function rowMatchesMeetingDate(row: SheetRow, meetingStart: Date): boolean {
  const rowDateKey = sheetDateKey(row.fechaReunion);
  if (!rowDateKey) return false;
  return dateKeyInTimezone(meetingStart, timezoneForCountry(row.pais)) === rowDateKey;
}

// Quita todo lo que no sea letra/número (espacios, puntos, guiones) — para
// comparar un dominio corto contra el nombre completo de la empresa sin que
// un espacio de más/de menos rompa el match (ver fuzzyMatch abajo).
function fuzzyCompanyKey(name: string): string {
  return normalizeCompanyName(name).replace(/[^a-z0-9]/g, '');
}

// Filtro por empresa/prospecto dentro de un conjunto ya acotado de filas
// candidatas (por fecha). Solo devuelve una fila si el filtro deja
// exactamente una — con más de una no hay forma de saber cuál es sin
// adivinar.
function desambiguarPorEmpresa(candidatos: SheetRow[], empresaContraparte: string | null): SheetRow | null {
  const empresaNorm = normalizeCompanyName(empresaContraparte);
  if (!empresaNorm) return null;

  let match = candidatos.filter((row) => normalizeCompanyName(row.empresa) === empresaNorm);

  const empresaSinTld = stripDomainSuffix(empresaNorm);
  if (match.length === 0 && empresaSinTld !== empresaNorm) {
    match = candidatos.filter((row) => normalizeCompanyName(row.empresa) === empresaSinTld);
  }

  // Bug real (09-09-2026, Intime Chile): el dominio del correo suele ser una
  // versión corta del nombre (ej. "intime.cl" -> sin TLD "intime"), mientras
  // el excel tiene el nombre completo con el país incluido ("Intime Chile")
  // — ninguno de los dos matches de arriba (exactos) calza ahí. Último
  // fallback: comparar ambos sin separadores y aceptar que uno CONTENGA al
  // otro (mínimo 3 caracteres, ver bug de "wom.cl" más abajo, para no
  // matchear por casualidad con nombres cortísimos tipo "ab"). Solo se usa
  // dentro de un conjunto YA acotado por fecha exacta, así que el riesgo de
  // un falso positivo es bajo.
  //
  // Segundo bug real (10-09-2026, Banco BICE): a diferencia de "Intime
  // Chile" (la palabra de más va al FINAL), acá la excel tiene la palabra de
  // más al PRINCIPIO ("Banco BICE" vs. dominio "bice.cl" -> sin TLD "bice")
  // — "bice" nunca es prefijo de "bancobice" (empieza con "banco"), así que
  // el `startsWith` de antes no lo encontraba y la reunión se quedaba sin
  // client_id para siempre (candidatosPorFecha.length > 1 nunca cae al
  // fallback viejo por empresa — ver matchMeetingRow). Cambiado de
  // startsWith a includes para cubrir la palabra de más en cualquier
  // posición, no solo al final.
  // Tercer bug real (11-09-2026, "wom.cl"/WOM Chile): el mínimo de 4
  // caracteres descartaba de plano cualquier dominio corto de 3 letras (ej.
  // "wom", tras sacarle el TLD) aunque el nombre del excel lo contuviera
  // claramente ("WOM Chile" -> "womchile" sí incluye "wom"). Bajado a 3 --
  // el riesgo de falso positivo se mantiene bajo porque esto solo corre
  // dentro de un conjunto ya acotado por fecha exacta (ver comentario de
  // arriba), y 2 caracteres sí sería demasiado corto para evitar choques.
  if (match.length === 0) {
    const key = fuzzyCompanyKey(empresaSinTld || empresaNorm);
    if (key.length >= 3) {
      match = candidatos.filter((row) => {
        const rowKey = fuzzyCompanyKey(row.empresa);
        return rowKey.length >= 3 && (rowKey.includes(key) || key.includes(rowKey));
      });
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
    const meetingStart = new Date(meeting.start_time);
    const candidatosPorFecha = rows.filter((row) => rowMatchesMeetingDate(row, meetingStart));

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
         cliente_sales_manager = coalesce(nullif($7, ''), cliente_sales_manager),
         updated_at = now()
       where id = $8`,
      [clientId, match.contacto, match.cargo, match.industria, match.idReunion, match.empresa, match.salesManager, meetingId]
    );
    console.log(
      `[metas-sheet] reunión ${meetingId}: match encontrado (cliente="${match.cliente}", contacto="${match.contacto}")`
    );
  } catch (error) {
    console.error(`[metas-sheet] reunión ${meetingId}: error resolviendo cliente/contacto`, error);
  }
}

// resolveMeetingClientAndContact no toca nada si la reunión ya tiene
// client_id — bien para no pisar una asignación manual (ej. AssignClientForm,
// "Corregir cliente"), pero como consecuencia esa reunión NUNCA llega a
// intentar el match contra el excel: si el cliente se asignó a mano (en vez
// de por match automático), metas_sheet_match_id se queda null para
// siempre, y contacto_nombre/cargo/industria/empresa_nombre/
// cliente_sales_manager tampoco se llenan nunca — bug real (09-09-2026,
// Intime Chile/Julio Antunez): el usuario corrigió el cliente a mano y el
// botón de re-sincronizar no traía ninguno de esos datos porque no tenía de
// dónde sacarlos.
//
// Se usa desde el botón de re-sincronización manual (POST
// /meetings/:id/resync-calendar). Si ya hay metas_sheet_match_id, refresca
// desde esa MISMA fila (caso: columna nueva agregada después del match).
// Si no hay (caso: cliente asignado a mano, nunca hubo match), corre el
// matching de siempre (por fecha + empresa) para encontrar la fila y
// llenar los campos de contacto — sin tocar client_id en ningún caso, para
// no pisar la corrección manual del admin.
export async function refreshMatchedRowFields(meetingId: string): Promise<void> {
  const { rows } = await pool.query(
    `select empresa_contraparte, start_time, metas_sheet_match_id from meetings where id = $1`,
    [meetingId]
  );
  const meeting = rows[0];
  if (!meeting) return;

  const sheetRows = await loadReunionesRows();
  const row = meeting.metas_sheet_match_id
    ? sheetRows.find((r) => r.idReunion === meeting.metas_sheet_match_id) ?? null
    : matchMeetingRow(sheetRows, meeting);
  if (!row) return;

  await pool.query(
    `update meetings set
       contacto_nombre = coalesce(nullif($1, ''), contacto_nombre),
       contacto_cargo = coalesce(nullif($2, ''), contacto_cargo),
       contacto_industria = coalesce(nullif($3, ''), contacto_industria),
       metas_sheet_match_id = coalesce(metas_sheet_match_id, nullif($4, '')),
       empresa_nombre = coalesce(nullif($5, ''), empresa_nombre),
       cliente_sales_manager = coalesce(nullif($6, ''), cliente_sales_manager),
       updated_at = now()
     where id = $7`,
    [row.contacto, row.cargo, row.industria, row.idReunion, row.empresa, row.salesManager, meetingId]
  );
}
