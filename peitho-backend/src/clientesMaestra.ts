// Sincroniza la tabla `clients` de Peitho contra la "maestra de clientes"
// (otra pestaña del mismo spreadsheet que ya usa metasSheet.ts — Cliente |
// ID Cliente | Status Cliente) — pedido explícito del usuario (10-09-2026):
// necesita tener en Peitho todos los clientes ACTIVOS de esa maestra, cada
// uno con el mismo "ID Cliente" que usa otra herramienta de BullsEye, para
// poder vincularlos entre sistemas.
//
// No se fusiona con metasSheet.ts (que lee la pestaña "API Reuniones - IA")
// porque son pestañas y propósitos distintos — se detecta el tab por sus
// propias columnas, mismo patrón que ya usa metasSheet.ts para no
// hardcodear el nombre por si alguien lo renombra.

import { sheets_v4 } from 'googleapis';
import { getSheetsClientByEmail } from './google';
import { pool } from './db';

const REQUIRED_HEADERS = ['Cliente', 'ID Cliente', 'Status Cliente'];
const SHEETS_TIMEOUT_MS = 15_000;

async function findMaestraTabTitle(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<string> {
  const { data } = await sheets.spreadsheets.get(
    { spreadsheetId, fields: 'sheets.properties.title' },
    { timeout: SHEETS_TIMEOUT_MS }
  );
  const titles = (data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((title): title is string => Boolean(title));

  for (const title of titles) {
    const { data: headerData } = await sheets.spreadsheets.values.get(
      { spreadsheetId, range: `'${title}'!1:1` },
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

export interface SyncClientesResult {
  filas: number;
  creados: number;
  actualizados: number;
  sinCambios: number;
  omitidos: number; // sin nombre, o Status Cliente distinto de "Activo"
}

// Clave de match: el NOMBRE (única columna realmente única en `clients` —
// ver migración 021), nunca external_id — la maestra reutiliza a propósito
// el mismo ID Cliente entre variantes regionales de un mismo grupo (ej.
// Nisum / Nisum Perú / Nisum Colombia), así que buscar por external_id
// podría traer cualquiera de esas filas indistintamente. Cada nombre de la
// maestra es y debe seguir siendo un cliente separado en Peitho, para que
// el match automático de reuniones (por nombre exacto, en metasSheet.ts)
// no se rompa.
export async function syncClientesDesdeMaestra(): Promise<SyncClientesResult> {
  const spreadsheetId = process.env.METAS_SHEET_ID;
  const accountEmail = process.env.METAS_SHEET_GOOGLE_ACCOUNT_EMAIL;
  if (!spreadsheetId || !accountEmail) {
    throw new Error('Faltan METAS_SHEET_ID o METAS_SHEET_GOOGLE_ACCOUNT_EMAIL en las variables de entorno');
  }

  const { sheets } = await getSheetsClientByEmail(accountEmail);
  const tabTitle = await findMaestraTabTitle(sheets, spreadsheetId);

  const { data } = await sheets.spreadsheets.values.get(
    { spreadsheetId, range: `'${tabTitle}'!A:Z` },
    { timeout: SHEETS_TIMEOUT_MS }
  );

  const values = data.values ?? [];
  const header = (values[0] ?? []).map((h) => String(h).trim());
  const col = (name: string) => header.indexOf(name);

  const result: SyncClientesResult = { filas: 0, creados: 0, actualizados: 0, sinCambios: 0, omitidos: 0 };

  for (const raw of values.slice(1)) {
    const nombre = String(raw[col('Cliente')] ?? '').trim();
    const externalId = String(raw[col('ID Cliente')] ?? '').trim() || null;
    const status = String(raw[col('Status Cliente')] ?? '').trim().toLowerCase();

    if (!nombre) continue;
    result.filas += 1;

    if (status !== 'activo') {
      result.omitidos += 1;
      continue;
    }

    const { rows: existing } = await pool.query(`select id, external_id from clients where lower(name) = lower($1)`, [
      nombre,
    ]);

    if (existing[0]) {
      if (externalId && existing[0].external_id !== externalId) {
        await pool.query(`update clients set external_id = $1 where id = $2`, [externalId, existing[0].id]);
        result.actualizados += 1;
      } else {
        result.sinCambios += 1;
      }
    } else {
      await pool.query(`insert into clients (name, external_id) values ($1, $2)`, [nombre, externalId]);
      result.creados += 1;
    }
  }

  console.log(
    `[clientes-maestra] sync completo: ${result.filas} filas, ${result.creados} creados, ${result.actualizados} actualizados, ${result.sinCambios} sin cambios, ${result.omitidos} omitidos (inactivos o sin nombre)`
  );
  return result;
}
