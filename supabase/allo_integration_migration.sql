-- BullsEye · Integración Allo (gestión telefónica)
-- Asigna uno o más números de Allo a cada cliente para que la reportería
-- de llamadas (actividades, tasa de conexión, reuniones agendadas, tags)
-- se pueda filtrar por cliente.
-- Ejecutar en el SQL editor de Supabase (es idempotente).

create table if not exists client_allo_numbers (
  id                uuid primary key default uuid_generate_v4(),
  client_id         uuid not null references clients(id) on delete cascade,
  allo_number       text not null,          -- E.164, ej. +56233884944
  allo_number_name  text,                   -- nombre puesto en Allo, ej. "Vigatec Chile"
  created_at        timestamptz not null default now()
);

create index if not exists client_allo_numbers_client_idx
  on client_allo_numbers (client_id);

-- Un número de Allo solo puede estar gestionado por un cliente a la vez
-- (evita que la reportería se mezcle entre clientes).
create unique index if not exists client_allo_numbers_number_unique
  on client_allo_numbers (allo_number);
