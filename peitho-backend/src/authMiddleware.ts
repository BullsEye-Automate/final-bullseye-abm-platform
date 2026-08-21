// Fase E — verificación real del JWT de Supabase en el backend (no solo
// gating en el frontend), para que el scoping por client_id sea a nivel de
// API y no algo que un cliente pueda saltarse llamando al backend directo.

import { Request, Response, NextFunction } from 'express';
import { pool } from './db';
import { getSupabaseAdminClient } from './supabaseAdmin';

export interface PeithoUser {
  id: string;
  email: string;
  role: 'admin' | 'client';
  clientId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      peithoUser?: PeithoUser;
    }
  }
}

// Se usa solo en las rutas que llama el frontend web (peitho-frontend) con
// sesión de Supabase Auth. NO se aplica a las rutas que llama la extensión de
// Chrome (/meetings/lookup, /meetings/:id/audio) ni a los webhooks/OAuth de
// Google Calendar — esos no tienen (ni deberían tener) sesión de usuario.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) {
    res.status(401).json({ error: 'Falta el token de sesión' });
    return;
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      res.status(401).json({ error: 'Sesión inválida o expirada' });
      return;
    }

    const { rows } = await pool.query(`select role, client_id from peitho_user_roles where user_id = $1`, [
      data.user.id,
    ]);
    const roleRow = rows[0];
    if (!roleRow) {
      res
        .status(403)
        .json({ error: 'Tu cuenta todavía no tiene un rol asignado en Peitho — contacta al administrador' });
      return;
    }

    req.peithoUser = {
      id: data.user.id,
      email: data.user.email ?? '',
      role: roleRow.role,
      clientId: roleRow.client_id,
    };
    next();
  } catch (error) {
    console.error('Error verificando la sesión de Peitho', error);
    res.status(500).json({ error: 'Error verificando la sesión' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.peithoUser?.role !== 'admin') {
    res.status(403).json({ error: 'Esta acción requiere permisos de administrador' });
    return;
  }
  next();
}
