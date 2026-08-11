import 'dotenv/config';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pool } from './db';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

async function run() {
  await pool.query(`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const applied = new Set(
    (await pool.query('select name from _migrations')).rows.map((row) => row.name)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    console.log(`Aplicando migración: ${file}`);
    await pool.query(sql);
    await pool.query('insert into _migrations (name) values ($1)', [file]);
  }

  console.log('Migraciones al día.');
  await pool.end();
}

run().catch((error) => {
  console.error('Error al correr migraciones', error);
  process.exit(1);
});
