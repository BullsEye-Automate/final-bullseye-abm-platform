import 'dotenv/config';
import { pool } from '../db';
import { getCalendarClientByEmail } from '../google';

/**
 * Las reuniones guardadas ANTES de que empezáramos a capturar
 * `recurring_event_id` (ver migración 007) no lo tienen — este script las
 * revisa contra Google Calendar una sola vez y completa el campo, así el
 * filtro de "excluir recurrentes" en GET /meetings también les aplica
 * retroactivamente (de otro modo solo aplicaría a reuniones nuevas).
 *
 * Uso: npx tsx src/scripts/backfillRecurringEventId.ts
 */
async function main() {
  const { rows } = await pool.query<{ id: string; google_event_id: string | null; ejecutivo: string | null }>(
    `select id, google_event_id, ejecutivo
     from meetings
     where recurring_event_id is null and google_event_id is not null and ejecutivo is not null
     order by ejecutivo, start_time`
  );

  if (rows.length === 0) {
    console.log('No hay reuniones pendientes de revisar.');
    await pool.end();
    return;
  }

  console.log(`Revisando ${rows.length} reuniones contra Google Calendar...`);

  const calendarClients = new Map<string, Awaited<ReturnType<typeof getCalendarClientByEmail>>['calendar']>();
  let updated = 0;
  let checked = 0;

  for (const row of rows) {
    const ejecutivo = row.ejecutivo as string;

    let calendar = calendarClients.get(ejecutivo);
    if (!calendar) {
      try {
        ({ calendar } = await getCalendarClientByEmail(ejecutivo));
        calendarClients.set(ejecutivo, calendar);
      } catch (error: any) {
        console.warn(`Sin credenciales de Google para ${ejecutivo}, se saltan sus reuniones:`, error?.message ?? error);
        continue;
      }
    }

    try {
      const { data } = await calendar.events.get({ calendarId: 'primary', eventId: row.google_event_id! });
      checked += 1;
      if (data.recurringEventId) {
        await pool.query('update meetings set recurring_event_id = $1, updated_at = now() where id = $2', [
          data.recurringEventId,
          row.id,
        ]);
        updated += 1;
      }
    } catch (error: any) {
      console.warn(`No se pudo revisar la reunión ${row.id} (evento ${row.google_event_id}):`, error?.message ?? error);
    }
  }

  console.log(`Listo. ${checked} revisadas, ${updated} marcadas como recurrentes.`);
  await pool.end();
}

main().catch((error) => {
  console.error('Error revisando reuniones recurrentes', error);
  process.exit(1);
});
