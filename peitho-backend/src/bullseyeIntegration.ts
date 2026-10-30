// Integración con el portal de BullsEye (portal.bullseye-abm.com) — pedido
// explícito del usuario (30-10-2026): los clientes que tienen Peitho
// contratado junto con los servicios de BullsEye ven Peitho DENTRO del portal
// de BullsEye (Pulso ABM → Peitho y Oportunidades → Peitho), y el equipo de
// BullsEye crea sus usuarios desde ahí. app.peithob2b.com queda para quienes
// contratan solo Peitho.
//
// Cómo funciona: el servidor del portal de BullsEye llama a este backend con
// una clave compartida (PEITHO_INTEGRATION_KEY, header
// x-peitho-integration-key) y el cliente de BullsEye en headers. Acá se
// resuelve a qué cliente de Peitho corresponde y la request sigue como si
// fuera un usuario "client" (sub-rol admin) de ese cliente: mismo scoping por
// grupo de external_id que ya aplican todas las rutas (resolveClientGroupIds),
// sin poder llegar nunca a una ruta requireAdmin (rol BullsEye).
//
// Match del cliente (mismo "ID Cliente" de la Maestra que ya trae
// clientesMaestra.ts en clients.external_id):
//   1. clients.external_id = id o slug del cliente en el portal de BullsEye
//      (la Maestra usa cualquiera de los dos — ver masterClients.ts del portal).
//      Si hay varias variantes con ese external_id (ej. Nisum / Nisum Perú),
//      gana la de nombre igual; si ninguna calza, la primera (las rutas ven
//      todo el grupo igual).
//   2. Si no hay ninguna con ese external_id: nombre exacto (sin mayúsculas).

import crypto from 'crypto';
import { Request } from 'express';
import { pool } from './db';
import type { PeithoUser } from './authMiddleware';

export const INTEGRATION_KEY_HEADER = 'x-peitho-integration-key';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function hasIntegrationKey(req: Request): boolean {
  return typeof req.headers[INTEGRATION_KEY_HEADER] === 'string';
}

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export interface IntegrationClient {
  id: string;
  name: string;
  external_id: string | null;
}

export async function resolveBullseyeClient(ids: string[], name: string | null): Promise<IntegrationClient | null> {
  const cleanIds = ids.map((x) => x.trim()).filter(Boolean);
  if (cleanIds.length) {
    const { rows } = await pool.query(
      `select id, name, external_id from clients where external_id = any($1) order by name asc`,
      [cleanIds]
    );
    if (rows.length === 1) return rows[0];
    if (rows.length > 1) {
      const byName = name ? rows.find((r) => norm(r.name) === norm(name)) : null;
      return byName ?? rows[0];
    }
  }
  if (name) {
    const { rows } = await pool.query(`select id, name, external_id from clients where lower(name) = lower($1)`, [
      name.trim(),
    ]);
    if (rows[0]) return rows[0];
  }
  return null;
}

export type IntegrationAuthResult =
  | { ok: true; user: PeithoUser; client: IntegrationClient }
  | { ok: false; status: number; error: string };

// Valida la clave y resuelve el cliente. Nunca acepta la request si la
// variable PEITHO_INTEGRATION_KEY no está configurada.
export async function authenticateIntegration(req: Request): Promise<IntegrationAuthResult> {
  const expected = process.env.PEITHO_INTEGRATION_KEY;
  const given = req.headers[INTEGRATION_KEY_HEADER];
  if (!expected || typeof given !== 'string' || !safeEqual(given, expected)) {
    return { ok: false, status: 401, error: 'Clave de integración inválida' };
  }

  const header = (name: string) => {
    const v = req.headers[name];
    return typeof v === 'string' && v.trim() ? decodeURIComponent(v.trim()) : null;
  };
  const ids = [header('x-bullseye-client-id'), header('x-bullseye-client-slug')].filter((x): x is string => !!x);
  const name = header('x-bullseye-client-name');
  if (!ids.length && !name) {
    return { ok: false, status: 400, error: 'Falta el cliente de BullsEye' };
  }

  const client = await resolveBullseyeClient(ids, name);
  if (!client) {
    return {
      ok: false,
      status: 404,
      error: `El cliente "${name ?? ids[0]}" no existe en Peitho (se busca por ID Cliente de la Maestra y luego por nombre)`,
    };
  }

  return {
    ok: true,
    client,
    user: {
      id: 'bullseye-integration',
      email: 'integracion@bullseye-abm.com',
      role: 'client',
      clientId: client.id,
      clientSubRole: 'admin',
    },
  };
}
