import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db';
import { getSupabaseAdminClient } from '../supabaseAdmin';
import { resolveClientGroupIds } from '../knowledgeBase';
import { authenticateIntegration, IntegrationClient } from '../bullseyeIntegration';

// Rutas propias de la integración con el portal de BullsEye (ver
// bullseyeIntegration.ts). El resto de lo que muestra el portal (panel,
// reuniones, research) usa las rutas de siempre con la misma clave — acá solo
// va lo que no existía para un rol "client": ver a qué cliente de Peitho se
// resolvió y gestionar los usuarios de ESE cliente (el equipo de BullsEye los
// crea desde Configuración → Cliente del portal).
export const integrationRouter = Router();

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      integrationClient?: IntegrationClient;
    }
  }
}

async function requireIntegration(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authenticateIntegration(req);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    req.peithoUser = result.user;
    req.integrationClient = result.client;
    next();
  } catch (error) {
    console.error('Error verificando la integración con BullsEye', error);
    res.status(500).json({ error: 'Error verificando la integración' });
  }
}

integrationRouter.use('/integration', requireIntegration);

// Cliente de Peitho al que se resolvió el cliente de BullsEye (diagnóstico)
integrationRouter.get('/integration/client', (req, res) => {
  res.json(req.integrationClient);
});

// Usuarios con rol "client" de este cliente (todo su grupo de external_id)
integrationRouter.get('/integration/users', async (req, res) => {
  try {
    const groupIds = await resolveClientGroupIds(req.integrationClient!.id);
    const { rows } = await pool.query(
      `select r.user_id, r.email, r.client_sub_role, r.created_at, c.name as client_name
       from peitho_user_roles r
       left join clients c on c.id = r.client_id
       where r.role = 'client' and r.client_id = any($1)
       order by r.email asc`,
      [groupIds]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error en GET /integration/users', error);
    res.status(500).json({ error: 'Error consultando los usuarios' });
  }
});

// Contraseña temporal legible (sin caracteres ambiguos) — misma idea que el
// alta de accesos del portal de BullsEye.
function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(14);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 7)}-${out.slice(7)}`;
}

async function findAuthUserByEmail(normalizedEmail: string) {
  const supabase = getSupabaseAdminClient();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const found = data.users.find((u) => u.email?.toLowerCase() === normalizedEmail);
    if (found) return found;
    if (data.users.length < 200) break;
  }
  return null;
}

// Alta de un usuario del cliente desde el portal de BullsEye (30-10-2026).
// SIN correo de invitación ni link mágico: el link de Supabase se "vence" al
// abrirlo desde el filtro de seguridad del correo o el navegador de la app de
// correo, y el cliente nunca podía entrar (mismo problema documentado en el
// CLAUDE.md, sección "Alta masiva de usuarios"). Acá se crea la cuenta ya
// confirmada con una contraseña temporal que el portal muestra UNA vez; la
// persona entra a app.peithob2b.com y la cambia en /cambiar-password.
//   - Email nuevo → se crea con contraseña temporal.
//   - Email que ya existe pero nunca confirmó, o que no tenía acceso a Peitho →
//     se le pone una contraseña temporal nueva (y se confirma).
//   - Email que ya tenía acceso → solo se actualiza el rol (sin tocar su clave).
// Siempre role 'client' del cliente resuelto; nunca crea ni degrada un admin.
integrationRouter.post('/integration/users', async (req, res) => {
  const { email, clientSubRole } = req.body ?? {};
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    res.status(400).json({ error: 'Email inválido' });
    return;
  }
  const subRole = clientSubRole === 'user' ? 'user' : 'admin';

  try {
    const supabase = getSupabaseAdminClient();
    const normalizedEmail = email.trim().toLowerCase();
    let authUser = await findAuthUserByEmail(normalizedEmail);

    let hadAccessBefore = false;
    if (authUser) {
      const { rows } = await pool.query(`select role from peitho_user_roles where user_id = $1`, [authUser.id]);
      hadAccessBefore = rows.length > 0;
      if (rows[0]?.role === 'admin') {
        res.status(409).json({ error: 'Ese email ya es administrador de Peitho' });
        return;
      }
    }

    let password: string | null = null;
    if (!authUser) {
      password = generateTempPassword();
      const { data, error } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
      });
      if (error || !data?.user) {
        console.error('Error creando usuario en Supabase Auth (integración)', error);
        res.status(500).json({ error: `No se pudo crear el usuario (${error?.message ?? 'error desconocido'})` });
        return;
      }
      authUser = data.user;
    } else if (!authUser.email_confirmed_at || !hadAccessBefore) {
      password = generateTempPassword();
      const { error } = await supabase.auth.admin.updateUserById(authUser.id, { password, email_confirm: true });
      if (error) {
        res.status(500).json({ error: `No se pudo asignar la contraseña (${error.message})` });
        return;
      }
    }

    await pool.query(
      `insert into peitho_user_roles (user_id, email, role, client_id, client_sub_role)
       values ($1, $2, 'client', $3, $4)
       on conflict (user_id) do update set email = excluded.email, role = 'client',
         client_id = excluded.client_id, client_sub_role = excluded.client_sub_role`,
      [authUser.id, authUser.email ?? normalizedEmail, req.integrationClient!.id, subRole]
    );

    res.status(201).json({ status: 'ok', user_id: authUser.id, email: authUser.email ?? normalizedEmail, password });
  } catch (error) {
    console.error('Error en POST /integration/users', error);
    res.status(500).json({ error: 'Error creando el usuario' });
  }
});

// Nueva contraseña temporal para un usuario de este cliente (si la olvidó o
// nunca pudo entrar). Se muestra una sola vez en el portal.
integrationRouter.post('/integration/users/:userId/password', async (req, res) => {
  try {
    const groupIds = await resolveClientGroupIds(req.integrationClient!.id);
    const { rows } = await pool.query(
      `select user_id from peitho_user_roles where user_id = $1 and role = 'client' and client_id = any($2)`,
      [req.params.userId, groupIds]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'Usuario no encontrado en este cliente' });
      return;
    }
    const password = generateTempPassword();
    const { error } = await getSupabaseAdminClient().auth.admin.updateUserById(req.params.userId, {
      password,
      email_confirm: true,
    });
    if (error) {
      res.status(500).json({ error: `No se pudo cambiar la contraseña (${error.message})` });
      return;
    }
    res.json({ status: 'ok', password });
  } catch (error) {
    console.error('Error en POST /integration/users/:userId/password', error);
    res.status(500).json({ error: 'Error cambiando la contraseña' });
  }
});

// Quitar acceso: solo a usuarios "client" de este mismo cliente (grupo)
integrationRouter.delete('/integration/users/:userId', async (req, res) => {
  try {
    const groupIds = await resolveClientGroupIds(req.integrationClient!.id);
    const { rowCount } = await pool.query(
      `delete from peitho_user_roles where user_id = $1 and role = 'client' and client_id = any($2)`,
      [req.params.userId, groupIds]
    );
    if (!rowCount) {
      res.status(404).json({ error: 'Usuario no encontrado en este cliente' });
      return;
    }
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Error en DELETE /integration/users/:userId', error);
    res.status(500).json({ error: 'Error quitando el acceso' });
  }
});
