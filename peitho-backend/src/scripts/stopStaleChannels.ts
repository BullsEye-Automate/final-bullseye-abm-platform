import 'dotenv/config';
import { pool } from '../db';
import { getCalendarClientByEmail } from '../google';

/**
 * Da de baja en Google (channels.stop) todos los canales de watch de una cuenta
 * excepto el más reciente, y borra esas filas de calendar_watch_channels.
 * Uso: npx tsx src/scripts/stopStaleChannels.ts jkarmy@bullseye-abm.com
 */
async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Uso: npx tsx src/scripts/stopStaleChannels.ts <google_account_email>');
    process.exit(1);
  }

  const { rows } = await pool.query<{ id: string; channel_id: string; resource_id: string; created_at: string }>(
    `select w.id, w.channel_id, w.resource_id, w.created_at
     from calendar_watch_channels w
     join google_credentials c on c.id = w.google_credential_id
     where c.google_account_email = $1
     order by w.created_at desc`,
    [email]
  );

  if (rows.length === 0) {
    console.log(`No hay canales registrados para ${email}.`);
    await pool.end();
    return;
  }

  const [mostRecent, ...stale] = rows;
  console.log(`Canal más reciente (se conserva): ${mostRecent.channel_id} (creado ${mostRecent.created_at})`);

  if (stale.length === 0) {
    console.log('No hay canales viejos que limpiar.');
    await pool.end();
    return;
  }

  const { calendar } = await getCalendarClientByEmail(email);

  for (const channel of stale) {
    try {
      await calendar.channels.stop({
        requestBody: { id: channel.channel_id, resourceId: channel.resource_id },
      });
      console.log(`Canal ${channel.channel_id} dado de baja en Google.`);
    } catch (error: any) {
      // Si Google ya no lo reconoce (ej. expiró solo), no es un error real — igual lo borramos de la base.
      console.warn(`No se pudo dar de baja en Google el canal ${channel.channel_id} (puede que ya haya expirado):`, error?.message ?? error);
    }

    await pool.query('delete from calendar_watch_channels where id = $1', [channel.id]);
    console.log(`Canal ${channel.channel_id} borrado de la base.`);
  }

  console.log(`Listo. Quedó activo solo: ${mostRecent.channel_id}`);
  await pool.end();
}

main().catch((error) => {
  console.error('Error limpiando canales', error);
  process.exit(1);
});
