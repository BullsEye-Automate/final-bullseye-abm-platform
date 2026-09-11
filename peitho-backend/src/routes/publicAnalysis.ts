import { Router } from 'express';
import { pool } from '../db';

// Router propio (mismo patrón que publicResearchRouter) — sin requireAuth en
// ningún punto, a propósito: este es el link que se comparte con el CLIENTE
// externo (pedido explícito del usuario, 11-09-2026) para que pueda leer el
// feedback/análisis post-reunión de UNA reunión puntual sin login a Peitho.
// El scoping de seguridad acá es el token en sí (uuid impredecible, generado
// en POST /meetings/:id/analysis/share) — nunca se expone client_id,
// pre_brief, transcript, ni ninguna otra reunión, solo lo mínimo necesario
// para leer el análisis de esta reunión.
export const publicAnalysisRouter = Router();

publicAnalysisRouter.get('/public/analysis/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const { rows } = await pool.query(
      `select m.contraparte, m.empresa_contraparte, m.empresa_nombre, m.ejecutivo,
              m.contacto_nombre, m.contacto_cargo, m.contacto_industria,
              m.start_time, m.analysis, c.name as cliente_bullseye
       from meetings m
       left join clients c on c.id = m.client_id
       where m.analysis_share_token = $1`,
      [token]
    );
    const meeting = rows[0];
    if (!meeting || !meeting.analysis) {
      res.status(404).json({ error: 'Este link no es válido, o todavía no hay análisis generado para compartir' });
      return;
    }

    res.json(meeting);
  } catch (error) {
    console.error('Error en GET /public/analysis/:token', error);
    res.status(500).json({ error: 'Error consultando el análisis' });
  }
});
