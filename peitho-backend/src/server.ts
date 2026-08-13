import 'dotenv/config';
import { app } from './app';
import { pool } from './db';

const port = process.env.PORT ? Number(process.env.PORT) : 3001;

// Si el proceso anterior murió a mitad de un research (ej. Ctrl+C, o un
// crash) el fire-and-forget nunca llegó a marcar 'failed', y esa reunión
// queda con pre_brief_status='running' para siempre — el botón "Iniciar
// research" del frontend queda deshabilitado sin ninguna forma de
// reintentarlo. Al arrancar el servidor, cualquier 'running' es
// necesariamente viejo (no hay ningún proceso en memoria trabajando en
// eso todavía), así que se resetea a 'failed' para que se pueda reintentar.
async function resetResearchColgados() {
  const { rowCount } = await pool.query(
    `update meetings set pre_brief_status = 'failed', updated_at = now() where pre_brief_status = 'running'`
  );
  if (rowCount && rowCount > 0) {
    console.log(`[startup] ${rowCount} research que habían quedado "running" de una corrida anterior, resetados a "failed"`);
  }
}

resetResearchColgados()
  .catch((error) => console.error('[startup] no se pudo resetear research colgados', error))
  .finally(() => {
    app.listen(port, () => {
      console.log(`Peitho backend escuchando en http://localhost:${port}`);
    });
  });
