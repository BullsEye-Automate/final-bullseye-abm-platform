import 'dotenv/config';
import { pool } from '../db';
import { getCalendarClientByEmail } from '../google';

/**
 * Las reuniones guardadas ANTES de que empezáramos a capturar
 * `recurring_event_id` (ver migración 007) no lo tienen — este script las
 * completa retroactivamente, así el filtro de "excluir recurrentes" en
 * GET /meetings también les aplica (de otro modo solo aplicaría a reuniones
 * nuevas).
 *
 * v2: en vez de una consulta a Google por cada reunión guardada (7000+
 * consultas la primera vez que se probó — demasiado lento, y una conexión
 * de Postgres inactiva se cortó a mitad de camino y tumbó el proceso
 * completo), se pide a Google la lista de eventos de una sola vez por
 * ejecutivo (`events.list`, paginado) cubriendo el rango de fechas que
 * necesitamos, y se cruza en memoria contra lo ya guardado.
 *
 * Uso: npx tsx src/scripts/backfillRecurringEventId.ts
 */
async function main() {
  const { rows: pendientes } = await pool.query<{
    id: string;
    google_event_id: string;
    ejecutivo: string;
  }>(
    `select id, google_event_id, ejecutivo
     from meetings
     where recurring_event_id is null and google_event_id is not null and ejecutivo is not null`
  );

  if (pendientes.length === 0) {
    console.log('No hay reuniones pendientes de revisar.');
    await pool.end();
    return;
  }

  const porEjecutivo = new Map<string, typeof pendientes>();
  for (const row of pendientes) {
    const lista = porEjecutivo.get(row.ejecutivo) ?? [];
    lista.push(row);
    porEjecutivo.set(row.ejecutivo, lista);
  }

  console.log(
    `${pendientes.length} reuniones pendientes, de ${porEjecutivo.size} ejecutivo(s). Pidiendo la lista de eventos a Google (no una consulta por reunión)...`
  );

  let totalActualizadas = 0;

  for (const [ejecutivo, rowsDeEsteEjecutivo] of porEjecutivo) {
    console.log(`[${ejecutivo}] revisando ${rowsDeEsteEjecutivo.length} reuniones...`);

    let calendar;
    try {
      ({ calendar } = await getCalendarClientByEmail(ejecutivo));
    } catch (error: any) {
      console.warn(`[${ejecutivo}] sin credenciales de Google, se saltan sus reuniones:`, error?.message ?? error);
      continue;
    }

    // Rango amplio (1 año atrás, 3 años adelante) para cubrir tanto el
    // historial ya limitado a 90 días en el frontend como series recurrentes
    // que Google ya generó muy hacia el futuro (se vieron filas hasta 2051).
    const timeMin = new Date();
    timeMin.setFullYear(timeMin.getFullYear() - 1);
    const timeMax = new Date();
    timeMax.setFullYear(timeMax.getFullYear() + 3);

    const recurringByEventId = new Map<string, string>();
    let pageToken: string | undefined;
    let paginas = 0;

    do {
      paginas += 1;
      const { data } = await calendar.events.list(
        {
          calendarId: 'primary',
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          maxResults: 2500,
          pageToken,
        },
        { timeout: 30_000 }
      );

      for (const event of data.items ?? []) {
        if (event.id && event.recurringEventId) {
          recurringByEventId.set(event.id, event.recurringEventId);
        }
      }

      pageToken = data.nextPageToken ?? undefined;
      console.log(`[${ejecutivo}] página ${paginas} de Google revisada (${data.items?.length ?? 0} eventos)`);
    } while (pageToken);

    for (const row of rowsDeEsteEjecutivo) {
      const recurringEventId = recurringByEventId.get(row.google_event_id);
      if (!recurringEventId) continue;

      await pool.query('update meetings set recurring_event_id = $1, updated_at = now() where id = $2', [
        recurringEventId,
        row.id,
      ]);
      totalActualizadas += 1;
    }

    console.log(`[${ejecutivo}] listo — ${recurringByEventId.size} eventos recurrentes encontrados en el rango.`);
  }

  console.log(`Listo. ${totalActualizadas} reuniones marcadas como recurrentes.`);
  await pool.end();
}

main().catch((error) => {
  console.error('Error revisando reuniones recurrentes', error);
  process.exit(1);
});
