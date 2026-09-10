import { Router } from 'express';
import { pool } from '../db';

// Router propio (mismo patrón que webhooksRouter) — sin requireAuth en
// ningún punto, a propósito: este es el link que se comparte con el CLIENTE
// externo (pedido explícito del usuario, 10-09-2026) para que pueda leer el
// research de UNA reunión puntual sin login a Peitho. El scoping de
// seguridad acá es el token en sí (uuid impredecible, generado en
// POST /meetings/:id/research/share) — nunca se expone client_id, análisis,
// transcript, ni ninguna otra reunión, solo lo mínimo necesario para leer el
// research de esta reunión.
export const publicResearchRouter = Router();

publicResearchRouter.get('/public/research/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const { rows } = await pool.query(
      `select m.contraparte, m.empresa_contraparte, m.empresa_nombre,
              m.contacto_nombre, m.contacto_cargo, m.contacto_industria,
              m.start_time, m.pre_brief, c.name as cliente_bullseye
       from meetings m
       left join clients c on c.id = m.client_id
       where m.research_share_token = $1`,
      [token]
    );
    const meeting = rows[0];
    if (!meeting || !meeting.pre_brief) {
      res.status(404).json({ error: 'Este link no es válido, o todavía no hay research generado para compartir' });
      return;
    }

    res.json(meeting);
  } catch (error) {
    console.error('Error en GET /public/research/:token', error);
    res.status(500).json({ error: 'Error consultando el research' });
  }
});
