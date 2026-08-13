-- Peitho — enriquecimiento de contacto desde el excel de metas (Google Sheets)
-- y modelo de "clientes" de BullsEye (necesario también para la Base de
-- conocimiento del Módulo 3, que se agrega en una migración posterior).

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- "ID Cliente" del excel de metas, cuando existe — permite reconciliar sin
  -- depender de que el nombre se escriba siempre igual.
  external_id text unique,
  created_at timestamptz not null default now()
);

alter table meetings
  add column if not exists client_id uuid references clients(id),
  add column if not exists contacto_nombre text,
  add column if not exists contacto_cargo text,
  add column if not exists contacto_industria text,
  -- "ID Reunión" de la fila del excel que hizo match, solo para debug de la
  -- lógica de matching (nunca se muestra al usuario).
  add column if not exists metas_sheet_match_id text;

create index if not exists idx_meetings_client_id on meetings (client_id);
