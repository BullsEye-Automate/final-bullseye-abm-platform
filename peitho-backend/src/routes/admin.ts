import { Router } from 'express';
import { pool } from '../db';
import { getSupabaseAdminClient } from '../supabaseAdmin';
import { requireAuth, requireAdmin } from '../authMiddleware';

export const adminRouter = Router();

// URL del frontend a la que Supabase redirige el link del correo de
// invitación (23-09-2026) — ahí vive /invitacion, la página pública que
// captura la sesión del link y le pide al usuario nuevo que elija una
// contraseña. Mismo dominio que DEFAULT_FRONTEND_ORIGINS en app.ts.
function inviteRedirectUrl(): string {
  return process.env.PEITHO_INVITE_REDIRECT_URL ?? 'https://app.peithob2b.com/invitacion';
}

// Lo consume el frontend para saber qué rol tiene el usuario logueado y
// decidir qué mostrar (ej. el filtro de cliente en admin, o mandar a un
// usuario "client" directo a su propia base de conocimiento).
adminRouter.get('/me', requireAuth, async (req, res) => {
  const user = req.peithoUser!;
  let clientName: string | null = null;
  if (user.clientId) {
    const { rows } = await pool.query(`select name from clients where id = $1`, [user.clientId]);
    clientName = rows[0]?.name ?? null;
  }
  res.json({
    email: user.email,
    role: user.role,
    clientId: user.clientId,
    clientName,
    clientSubRole: user.clientSubRole,
  });
});

adminRouter.get('/admin/user-roles', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `select r.user_id, r.email, r.role, r.client_id, r.client_sub_role, c.name as client_name
       from peitho_user_roles r
       left join clients c on c.id = r.client_id
       order by r.email asc`
    );
    res.json(rows);
  } catch (error) {
    console.error('Error en GET /admin/user-roles', error);
    res.status(500).json({ error: 'Error consultando los roles' });
  }
});

// Si el email ya existe en Supabase Auth, solo se le asigna el rol de
// Peitho. Si no existe todavía, se crea acá mismo con una invitación
// (23-09-2026, pedido explícito del usuario — antes había que crearlo a mano
// en Supabase Studio primero) — Supabase le manda un correo con un link para
// que el usuario nuevo elija su contraseña (ver /invitacion en el frontend).
adminRouter.post('/admin/user-roles', requireAuth, requireAdmin, async (req, res) => {
  const { email, role, clientId, clientSubRole } = req.body ?? {};

  if (typeof email !== 'string' || !email.trim()) {
    res.status(400).json({ error: 'Falta el email' });
    return;
  }
  if (role !== 'admin' && role !== 'client') {
    res.status(400).json({ error: 'El rol debe ser "admin" o "client"' });
    return;
  }
  if (role === 'client' && typeof clientId !== 'string') {
    res.status(400).json({ error: 'Un usuario de tipo cliente necesita un cliente asociado' });
    return;
  }
  // Sub-rol (23-09-2026, ver migración 032) — solo aplica/valida para
  // role==='client'; para 'admin' siempre se guarda null.
  if (role === 'client' && clientSubRole !== 'admin' && clientSubRole !== 'user') {
    res.status(400).json({ error: 'Un usuario de tipo cliente necesita un sub-rol ("admin" o "user")' });
    return;
  }

  try {
    const supabase = getSupabaseAdminClient();
    const normalizedEmail = email.trim().toLowerCase();

    // Esta versión de supabase-js no tiene un lookup directo por email en
    // auth.admin — se pagina listUsers() y se busca a mano (equipo chico, no
    // hay miles de usuarios de Peitho).
    let authUser: { id: string; email?: string; email_confirmed_at?: string } | null = null;
    for (let page = 1; page <= 20 && !authUser; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      authUser = data.users.find((u) => u.email?.toLowerCase() === normalizedEmail) ?? null;
      if (data.users.length < 200) break;
    }

    let invited = false;
    let resendError: string | null = null;
    if (!authUser) {
      const { data, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(normalizedEmail, {
        redirectTo: inviteRedirectUrl(),
      });
      if (inviteError || !data?.user) {
        console.error('Error invitando usuario nuevo a Supabase Auth', inviteError);
        res.status(500).json({
          error: `No se pudo crear el usuario (${inviteError?.message ?? 'error desconocido'})`,
        });
        return;
      }
      authUser = data.user;
      invited = true;
    } else if (!authUser.email_confirmed_at) {
      // Nunca aceptó una invitación anterior (ej. el link se gastó solo —
      // pasa seguido si el filtro de seguridad del correo "abre" el link
      // automático antes que la persona) — se reintenta mandar una
      // invitación nueva en vez de dejarla asignada sin ningún link
      // funcionando. Si Supabase igual rechaza el reenvío, no bloquea la
      // asignación del rol — se avisa en la respuesta para reenviar a mano
      // desde Supabase Studio.
      const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(normalizedEmail, {
        redirectTo: inviteRedirectUrl(),
      });
      if (inviteError) {
        console.error('Error reenviando invitación a usuario sin confirmar', inviteError);
        resendError = inviteError.message;
      } else {
        invited = true;
      }
    }

    await pool.query(
      `insert into peitho_user_roles (user_id, email, role, client_id, client_sub_role)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id) do update set email = excluded.email, role = excluded.role,
         client_id = excluded.client_id, client_sub_role = excluded.client_sub_role`,
      [
        authUser.id,
        authUser.email ?? normalizedEmail,
        role,
        role === 'client' ? clientId : null,
        role === 'client' ? clientSubRole : null,
      ]
    );

    res.status(201).json({ status: 'ok', invited, resendError });
  } catch (error) {
    console.error('Error en POST /admin/user-roles', error);
    res.status(500).json({ error: 'Error asignando el rol' });
  }
});

adminRouter.delete('/admin/user-roles/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query(`delete from peitho_user_roles where user_id = $1`, [req.params.userId]);
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Error en DELETE /admin/user-roles/:userId', error);
    res.status(500).json({ error: 'Error revocando el rol' });
  }
});
