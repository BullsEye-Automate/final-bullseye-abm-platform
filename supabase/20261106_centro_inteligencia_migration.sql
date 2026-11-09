-- BullsEye · Centro de prospección — Inteligencia de la semana (nov-2026)
-- Una fila por cliente del portal y semana (lunes, AAAA-MM-DD): números de la
-- cuenta (stock de los SDR, segmentos que funcionan), propuestas de la IA
-- (cargos, industrias, exclusiones, recordatorios) con su decisión (aprobada /
-- descartada) y costo de IA. Lo genera el cron /api/cron/centro-inteligencia
-- (viernes) a partir del Pulso ABM, las señales de llamadas de Allo
-- (allo_call_signals), las notas y llamadas de HubSpot, los rechazos del
-- cliente y el feedback de reuniones.
-- Ejecutar en el SQL editor de Supabase (es idempotente).

create table if not exists centro_intel (
  id            uuid        primary key default uuid_generate_v4(),
  client_id     uuid        not null references clients(id) on delete cascade,
  semana        date        not null,
  status        text        not null default 'ok' check (status in ('ok', 'sin_datos', 'error')),
  numbers       jsonb       not null default '{}'::jsonb,
  result        jsonb       not null default '{}'::jsonb,
  error         text,
  model         text,
  cost_usd      numeric(10, 4),
  generated_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    text,
  unique (client_id, semana)
);

create index if not exists centro_intel_semana_idx on centro_intel (semana);

alter table centro_intel enable row level security;
