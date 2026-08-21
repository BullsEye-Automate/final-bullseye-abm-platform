import { Router } from 'express';
import { pool } from '../db';
import { getSupabaseAdminClient } from '../supabaseAdmin';
import { requireAuth, requireAdmin } from '../authMiddleware';

export const adminRouter = Router();

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
  res.json({ email: user.email, role: user.role, clientId: user.clientId, clientName });
});

adminRouter.get('/admin/user-roles', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `select r.user_id, r.email, r.role, r.client_id, c.name as client_name
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

// El usuario de Supabase Auth tiene que existir de antes (se crea a mano en
// Supabase Studio → Authentication → Users — no hay signup público, mismo
// patrón que bullseye-abm-platform). Esto solo le asigna un rol de Peitho.
adminRouter.post('/admin/user-roles', requireAuth, requireAdmin, async (req, res) => {
  const { email, role, clientId } = req.body ?? {};

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

  try {
    const supabase = getSupabaseAdminClient();
    const normalizedEmail = email.trim().toLowerCase();

    // Esta versión de supabase-js no tiene un lookup directo por email en
    // auth.admin — se pagina listUsers() y se busca a mano (equipo chico, no
    // hay miles de usuarios de Peitho).
    let authUser: { id: string; email?: string } | null = null;
    for (let page = 1; page <= 20 && !authUser; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      authUser = data.users.find((u) => u.email?.toLowerCase() === normalizedEmail) ?? null;
      if (data.users.length < 200) break;
    }

    if (!authUser) {
      res.status(404).json({
        error:
          'No existe un usuario de Supabase Auth con ese email — créalo primero en Supabase Studio → Authentication → Users',
      });
      return;
    }

    await pool.query(
      `insert into peitho_user_roles (user_id, email, role, client_id)
       values ($1, $2, $3, $4)
       on conflict (user_id) do update set email = excluded.email, role = excluded.role, client_id = excluded.client_id`,
      [authUser.id, authUser.email ?? normalizedEmail, role, role === 'client' ? clientId : null]
    );

    res.status(201).json({ status: 'ok' });
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
