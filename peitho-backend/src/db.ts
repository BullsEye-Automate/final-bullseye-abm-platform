import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('Falta la variable de entorno DATABASE_URL (ver .env.example)');
}

// Supabase requiere TLS pero con un certificado que Node no valida por defecto.
export const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('supabase.co') ? { rejectUnauthorized: false } : undefined,
  // Sin esto, una conexión de red trabada cuelga la request indefinidamente
  // en vez de fallar con un error legible.
  connectionTimeoutMillis: 10_000,
  // connectionTimeoutMillis solo cubre CONECTARSE — una consulta que ya está
  // corriendo y se cuelga a mitad de camino (ej. un hipo de red de Supabase
  // después de conectar) puede quedar pegada para siempre sin esto. Se
  // detectó real: una consulta de calendarSync.ts se quedó colgada 3+ minutos
  // sin ningún error ni progreso.
  query_timeout: 15_000,
});

// Sin este listener, un error en una conexión inactiva del pool (ej. Supabase
// cortándola tras un rato sin uso, o el Mac suspendiéndose a mitad de un
// script largo) tumba TODO el proceso — 'pg' relanza el error si nadie lo
// escucha. Se detectó corriendo backfillRecurringEventId.ts toda una noche:
// se cortó una conexión inactiva y el proceso murió sin ningún otro log.
pool.on('error', (error) => {
  console.error('Error inesperado en una conexión inactiva del pool de Postgres (no se cae el proceso):', error);
});
