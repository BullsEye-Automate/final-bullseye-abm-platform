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

  // Filtro cascada (09-09-2026, pedido explícito del usuario): el frontend
  // exige elegir cliente antes de habilitar este selector, pero acá se acepta
  // igual sin cliente elegido (ej. rol "client", que ya tiene su client_id
  // fijo) — permite ver el desempeño de un ejecutivo puntual dentro del
  // dashboard entero (KPIs, funnel, distribución y segmentos), no solo en el
  // ranking de abajo.
  let ejecutivo: string | null = null;
  if (typeof req.query.ejecutivo === 'string' && req.query.ejecutivo) {
    ejecutivo = req.query.ejecutivo;
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
  // `baseConditions`/`baseParams` (sin el filtro de ejecutivo puntual) se
  // reusan para el ranking de ejecutivos de abajo — un ranking de "quién es
  // el mejor" no tiene sentido acotado a un solo ejecutivo ya elegido.
  const baseConditions: string[] = [
    'recurring_event_id is null',
    '(meeting_url is not null or lower(empresa_contraparte) is distinct from $1)',
  ];
  const baseParams: unknown[] = [INTERNAL_DOMAIN];

  if (from) {
    baseParams.push(from);
    baseConditions.push(`start_time >= $${baseParams.length}`);
  }
  if (to) {
    baseParams.push(to);
    baseConditions.push(`start_time <= $${baseParams.length}`);
  }
  if (clientId) {
    baseParams.push(clientId);
    baseConditions.push(`client_id = $${baseParams.length}`);
  }
  const baseWhereClause = baseConditions.join(' and ');

  const conditions = [...baseConditions];
  const params = [...baseParams];
  if (ejecutivo) {
    params.push(ejecutivo);
    conditions.push(`ejecutivo = $${params.length}`);
  }
  const whereClause = conditions.join(' and ');

  // Copia previa a agregar `threshold` — la query de distribución (abajo) no
  // referencia $thresholdIdx en absoluto, y Postgres rechaza el bind si se le
  // pasan más parámetros que placeholders referenciados en la query ("bind
  // message supplies N parameters, but prepared statement requires N-1").
  const paramsSinThreshold = [...params];

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
         avg((analysis->'desempeno_vendedor'->>'puntaje')::numeric) filter (where status = 'analyzed') as desempeno_vendedor_promedio,
         avg((analysis->'fit_empresa'->>'puntaje')::numeric) filter (where status = 'analyzed') as fit_empresa_promedio,
         avg((analysis->'fit_contacto'->>'puntaje')::numeric) filter (where status = 'analyzed') as fit_contacto_promedio
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

    // Distribución de prediccion_exito (1-5) — pedido explícito del usuario
    // (09-09-2026): "de 100 reuniones, tenemos 20% con predicción 1, 40% con
    // predicción 2, ...". Se completan los 5 baldes aunque alguno tenga 0
    // reuniones, para que el reporte muestre siempre la escala entera.
    const distribucionQuery = `
      select (analysis->'prediccion_exito'->>'puntaje')::int as puntaje, count(*) as total
      from meetings
      where status = 'analyzed' and (analysis->'prediccion_exito'->>'puntaje') is not null and ${whereClause}
      group by (analysis->'prediccion_exito'->>'puntaje')::int
    `;

    // Ranking de ejecutivos por desempeño (desempeno_vendedor.puntaje, 1-10)
    // — pedido explícito del usuario. Usa baseWhereClause (cliente + fechas,
    // SIN el filtro de un ejecutivo puntual) porque es un ranking entre
    // todos los ejecutivos, no el desempeño de uno solo. Mismo mínimo de
    // muestra (3 reuniones) que los otros segmentos, por la misma razón: no
    // mostrar a alguien como "el mejor" basado en una sola reunión.
    const porEjecutivoQuery = `
      select ejecutivo as label,
             count(*) as total,
             avg((analysis->'desempeno_vendedor'->>'puntaje')::numeric) as desempeno_promedio,
             avg((analysis->'prediccion_exito'->>'puntaje')::numeric) as prediccion_promedio
      from meetings
      where status = 'analyzed' and ejecutivo is not null and ${baseWhereClause}
      group by ejecutivo
      having count(*) >= 3
      order by avg((analysis->'desempeno_vendedor'->>'puntaje')::numeric) desc nulls last
    `;

    const [
      { rows: porCargoRows },
      { rows: porIndustriaRows },
      { rows: distribucionRows },
      { rows: porEjecutivoRows },
    ] = await Promise.all([
      pool.query(segmentQuery('contacto_cargo'), params),
      pool.query(segmentQuery('contacto_industria'), params),
      pool.query(distribucionQuery, paramsSinThreshold),
      pool.query(porEjecutivoQuery, baseParams),
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

    const distMap = new Map<number, number>();
    for (const row of distribucionRows) distMap.set(Number(row.puntaje), Number(row.total));
    const totalConPrediccion = Array.from(distMap.values()).reduce((sum, n) => sum + n, 0);
    const distribucionPrediccion = [1, 2, 3, 4, 5].map((puntaje) => {
      const total = distMap.get(puntaje) ?? 0;
      return { puntaje, total, pct: totalConPrediccion > 0 ? total / totalConPrediccion : 0 };
    });

    const porEjecutivo = porEjecutivoRows.map((r) => ({
      label: String(r.label),
      total: Number(r.total),
      desempeno_promedio: r.desempeno_promedio != null ? Number(r.desempeno_promedio) : null,
      prediccion_promedio: r.prediccion_promedio != null ? Number(r.prediccion_promedio) : null,
    }));

    res.json({
      meta: { from, to, threshold, client_id: clientId, ejecutivo },
      funnel,
      con_compromisos: Number(f.con_compromisos),
      desempeno_vendedor_promedio:
        f.desempeno_vendedor_promedio != null ? Number(f.desempeno_vendedor_promedio) : null,
      fit_empresa_promedio: f.fit_empresa_promedio != null ? Number(f.fit_empresa_promedio) : null,
      fit_contacto_promedio: f.fit_contacto_promedio != null ? Number(f.fit_contacto_promedio) : null,
      por_cargo: mapSegment(porCargoRows),
      por_industria: mapSegment(porIndustriaRows),
      distribucion_prediccion: distribucionPrediccion,
      por_ejecutivo: porEjecutivo,
    });
  } catch (error) {
    console.error('Error en GET /panel/funnel', error);
    res.status(500).json({ error: 'Error calculando el panel de control' });
  }
});

// Lista de ejecutivos disponibles para el selector cascada (elegir cliente
// primero, después ejecutivo) — pedido explícito del usuario (09-09-2026).
// Sin filtrar por status: un ejecutivo con reuniones agendadas/capturadas
// pero todavía ninguna analizada igual debería aparecer en el selector.
panelRouter.get('/panel/ejecutivos', requireAuth, async (req, res) => {
  const peithoUser = req.peithoUser!;

  let clientId: string | null = null;
  if (peithoUser.role === 'client') {
    clientId = peithoUser.clientId;
  } else if (typeof req.query.client_id === 'string' && req.query.client_id) {
    clientId = req.query.client_id;
  }

  const conditions: string[] = [
    'recurring_event_id is null',
    '(meeting_url is not null or lower(empresa_contraparte) is distinct from $1)',
    'ejecutivo is not null',
  ];
  const params: unknown[] = [INTERNAL_DOMAIN];
  if (clientId) {
    params.push(clientId);
    conditions.push(`client_id = $${params.length}`);
  }

  try {
    const { rows } = await pool.query(
      `select distinct ejecutivo from meetings where ${conditions.join(' and ')} order by ejecutivo asc`,
      params
    );
    res.json(rows.map((row) => row.ejecutivo as string));
  } catch (error) {
    console.error('Error en GET /panel/ejecutivos', error);
    res.status(500).json({ error: 'Error listando ejecutivos' });
  }
});
