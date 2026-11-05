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

function inviteRedirectUrl(): string {
  return process.env.PEITHO_INVITE_REDIRECT_URL ?? 'https://app.peithob2b.com/invitacion';
}

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

// Alta de un usuario del cliente: misma lógica que POST /admin/user-roles
// (invitación por correo si no existe, reenvío si nunca confirmó, correo de
// acceso si se le había revocado), pero siempre con role 'client' y el
// cliente ya resuelto — nunca puede crear un admin de BullsEye. Se duplica a
// propósito en vez de tocar admin.ts (en uso activo por otra línea de trabajo).
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

    let authUser: { id: string; email?: string; email_confirmed_at?: string } | null = null;
    for (let page = 1; page <= 20 && !authUser; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      authUser = data.users.find((u) => u.email?.toLowerCase() === normalizedEmail) ?? null;
      if (data.users.length < 200) break;
    }

    let hadAccessBefore = false;
    if (authUser) {
      const { rows } = await pool.query(`select role from peitho_user_roles where user_id = $1`, [authUser.id]);
      hadAccessBefore = rows.length > 0;
      // Nunca degradar a un admin de BullsEye a usuario cliente desde el portal
      if (rows[0]?.role === 'admin') {
        res.status(409).json({ error: 'Ese email ya es administrador de Peitho' });
        return;
      }
    }

    let invited = false;
    let resendError: string | null = null;
    if (!authUser) {
      const { data, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(normalizedEmail, {
        redirectTo: inviteRedirectUrl(),
      });
      if (inviteError || !data?.user) {
        console.error('Error invitando usuario nuevo a Supabase Auth (integración)', inviteError);
        res.status(500).json({ error: `No se pudo crear el usuario (${inviteError?.message ?? 'error desconocido'})` });
        return;
      }
      authUser = data.user;
      invited = true;
    } else if (!authUser.email_confirmed_at) {
      const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(normalizedEmail, {
        redirectTo: inviteRedirectUrl(),
      });
      if (inviteError) resendError = inviteError.message;
      else invited = true;
    } else if (!hadAccessBefore) {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: inviteRedirectUrl(),
      });
      if (resetError) resendError = resetError.message;
      else invited = true;
    }

    await pool.query(
      `insert into peitho_user_roles (user_id, email, role, client_id, client_sub_role)
       values ($1, $2, 'client', $3, $4)
       on conflict (user_id) do update set email = excluded.email, role = 'client',
         client_id = excluded.client_id, client_sub_role = excluded.client_sub_role`,
      [authUser.id, authUser.email ?? normalizedEmail, req.integrationClient!.id, subRole]
    );

    res.status(201).json({ status: 'ok', invited, resendError });
  } catch (error) {
    console.error('Error en POST /integration/users', error);
    res.status(500).json({ error: 'Error creando el usuario' });
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
