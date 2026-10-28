-- BullsEye · Academia SDR (Análisis → Academia SDR)
-- Capacitación para SDRs por cliente: 10 módulos ("vueltas") generados con
-- IA desde el Contexto IA + ICP del cliente y lo que se completa en el
-- formulario (servicio foco, países, industrias). Se muestra como HTML
-- interactivo con la identidad BullsEye. Solo la ve el equipo BullsEye.
--   - sdr_academies:        una fila por cliente (datos de entrada + estado)
--   - sdr_academy_modules:  un módulo por fila (se generan en paralelo)
-- Ejecutar en el SQL editor de Supabase (es idempotente).

create table if not exists sdr_academies (
  client_id     uuid primary key references clients(id) on delete cascade,
  inputs        jsonb not null default '{}'::jsonb,   -- focusService, countries, industries, notes
  generated_by  text,
  generated_at  timestamptz,
  updated_at    timestamptz not null default now()
);

create table if not exists sdr_academy_modules (
  client_id     uuid not null references clients(id) on delete cascade,
  module_no     int  not null check (module_no between 1 and 10),
  content       jsonb not null,
  model         text,
  generated_at  timestamptz not null default now(),
  primary key (client_id, module_no)
);

alter table sdr_academies enable row level security;
alter table sdr_academy_modules enable row level security;
