import { Router } from 'express';
import { pool } from '../db';
import { requireAuth } from '../authMiddleware';
import { INTERNAL_DOMAIN } from './meetings';

export const panelRouter = Router();

// Paso 6 — Panel de control tipo CRM. Decisión explícita con el usuario: en
// vez de un funnel con etapas de deal reales (eso vive en HubSpot, con
// propiedades bullseye_*, en la otra app — Peitho no lo tiene), el funnel y
// los KPIs se calculan con señales que Peitho YA tiene por sí solo:
// prediccion_exito.puntaje (1-5, predicción de Claude) como proxy de
// probabilidad de conversión, segmentado por contacto_cargo/contacto_industria
// (datos confirmados por el excel de metas, no adivinados). No es tasa de
// conversión real — se etiqueta como "predicha" en el frontend a propósito.
panelRouter.get('/panel/funnel', requireAuth, async (req, res) => {
  const peithoUser = req.peithoUser!;

  // Umbral (escala 1-5 de prediccion_exito) para contar una reunión como
  // "alta probabilidad" — default 4 ("Bueno"/"Muy bueno" en el prompt de
  // análisis), ajustable desde el filtro del dashboard.
  let threshold = 4;
  if (typeof req.query.threshold === 'string') {
    const parsed = parseInt(req.query.threshold, 10);
    if (!Number.isNaN(parsed)) threshold = Math.min(5, Math.max(1, parsed));
  }

  let clientId: string | null = null;
  if (peithoUser.role === 'client') {
    clientId = peithoUser.clientId;
  } else if (typeof req.query.client_id === 'string' && req.query.client_id) {
    clientId = req.query.client_id;
  }

  const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : null;
  const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : null;
  if ((from && Number.isNaN(Date.parse(from))) || (to && Number.isNaN(Date.parse(to)))) {
    res.status(400).json({ error: 'Rango de fechas inválido' });
    return;
  }

  // Mismo criterio de exclusión que GET /meetings: sin series recurrentes,
  // sin reuniones internas de BullsEye (salvo invitación manual del bot, que
  // trae meeting_url) — este dashboard mide desempeño con prospectos reales.
  const conditions: string[] = [
    'recurring_event_id is null',
    '(meeting_url is not null or lower(empresa_contraparte) is distinct from $1)',
  ];
  const params: unknown[] = [INTERNAL_DOMAIN];

  if (from) {
    params.push(from);
    conditions.push(`start_time >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`start_time <= $${params.length}`);
  }
  if (clientId) {
    params.push(clientId);
    conditions.push(`client_id = $${params.length}`);
  }
  const whereClause = conditions.join(' and ');

  params.push(threshold);
  const thresholdIdx = params.length;

  try {
    const { rows: funnelRows } = await pool.query(
      `select
         count(*) as agendadas,
         count(*) filter (where status in ('captured','analyzed')) as realizadas,
         count(*) filter (where status = 'analyzed') as analizadas,
         count(*) filter (where status = 'analyzed' and (analysis->'prediccion_exito'->>'puntaje')::int >= $${thresholdIdx}) as alta_prediccion,
         count(*) filter (where status = 'analyzed' and jsonb_array_length(coalesce(analysis->'compromisos', '[]'::jsonb)) > 0) as con_compromisos,
         avg((analysis->'desempeno_vendedor'->>'puntaje')::numeric) filter (where status = 'analyzed') as desempeno_vendedor_promedio
       from meetings
       where ${whereClause}`,
      params
    );

    const f = funnelRows[0];
    // Las 4 etapas son subconjuntos estrictos una de la otra (agendadas ⊇
    // realizadas ⊇ analizadas ⊇ alta_prediccion) para que el funnel se vea
    // siempre decreciente. "Con compromisos" NO entra acá — una reunión
    // analizada puede tener compromisos de seguimiento sin tener predicción
    // de éxito alta (o viceversa), así que no es un subconjunto de la etapa
    // anterior; se expone aparte como KPI independiente.
    const funnel = [
      { key: 'agendadas', label: 'Reuniones agendadas', count: Number(f.agendadas) },
      { key: 'realizadas', label: 'Reuniones realizadas', count: Number(f.realizadas) },
      { key: 'analizadas', label: 'Analizadas por Peitho', count: Number(f.analizadas) },
      { key: 'alta_prediccion', label: 'Predicción de éxito alta', count: Number(f.alta_prediccion) },
    ];

    // Segmentación por cargo/industria — solo sobre reuniones ya analizadas
    // (es la única población con prediccion_exito). `having count(*) >= 3`
    // evita que un cargo con una sola reunión aparezca con "100% de
    // conversión" — mínimo de muestra para que la tasa signifique algo.
    const segmentQuery = (column: 'contacto_cargo' | 'contacto_industria') => `
      select coalesce(${column}, 'Sin dato') as label,
             count(*) as total,
             count(*) filter (where (analysis->'prediccion_exito'->>'puntaje')::int >= $${thresholdIdx}) as alta_prediccion,
             avg((analysis->'prediccion_exito'->>'puntaje')::numeric) as puntaje_promedio
      from meetings
      where status = 'analyzed' and ${whereClause}
      group by coalesce(${column}, 'Sin dato')
      having count(*) >= 3
      order by (count(*) filter (where (analysis->'prediccion_exito'->>'puntaje')::int >= $${thresholdIdx}))::float / count(*) desc,
               count(*) desc
      limit 10
    `;

    const [{ rows: porCargoRows }, { rows: porIndustriaRows }] = await Promise.all([
      pool.query(segmentQuery('contacto_cargo'), params),
      pool.query(segmentQuery('contacto_industria'), params),
    ]);

    const mapSegment = (rows: Record<string, unknown>[]) =>
      rows.map((r) => {
        const total = Number(r.total);
        const altaPrediccion = Number(r.alta_prediccion);
        return {
          label: String(r.label),
          total,
          alta_prediccion: altaPrediccion,
          tasa: total > 0 ? altaPrediccion / total : 0,
          puntaje_promedio: r.puntaje_promedio != null ? Number(r.puntaje_promedio) : null,
        };
      });

    res.json({
      meta: { from, to, threshold, client_id: clientId },
      funnel,
      con_compromisos: Number(f.con_compromisos),
      desempeno_vendedor_promedio:
        f.desempeno_vendedor_promedio != null ? Number(f.desempeno_vendedor_promedio) : null,
      por_cargo: mapSegment(porCargoRows),
      por_industria: mapSegment(porIndustriaRows),
    });
  } catch (error) {
    console.error('Error en GET /panel/funnel', error);
    res.status(500).json({ error: 'Error calculando el panel de control' });
  }
});
