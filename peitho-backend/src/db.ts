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
});
