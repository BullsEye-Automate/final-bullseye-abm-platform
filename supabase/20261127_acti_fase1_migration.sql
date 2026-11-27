-- ACTI · Red de Negocios — Fase 1
-- Marca ACTI por cliente y configuración editable de planes.
-- Solo tablas nuevas: no toca clients, client_configs ni ninguna tabla existente.
-- Idempotente. Ejecutar en el SQL editor de Supabase.

-- ============================================================
-- 1. Socios ACTI (una fila por cliente ACTI; sin fila = cliente normal)
-- ============================================================
create table if not exists acti_members (
  client_id    uuid primary key references clients(id) on delete cascade,
  plan         text not null default 'freemium'
                 check (plan in ('freemium', 'conecta', 'crece', 'acelera')),
  status       text not null default 'en_prueba'
                 check (status in ('activo', 'en_prueba', 'pausado', 'baja')),
  joined_at    date not null default current_date,   -- alta en ACTI
  trial_start  date,                                  -- prueba Freemium
  trial_end    date,
  kam_email    text,
  notes        text,
  updated_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists acti_members_set_updated_at on acti_members;
create trigger acti_members_set_updated_at
  before update on acti_members
  for each row execute function set_updated_at();

create index if not exists acti_members_plan_idx on acti_members (plan, status);

alter table acti_members enable row level security;

-- Historial de cambios de plan / estado (para facturación y auditoría)
create table if not exists acti_members_log (
  id          uuid primary key default uuid_generate_v4(),
  client_id   uuid not null references clients(id) on delete cascade,
  change      jsonb not null,          -- { antes, despues }
  changed_by  text,
  changed_at  timestamptz not null default now()
);
create index if not exists acti_members_log_client_idx on acti_members_log (client_id, changed_at desc);
alter table acti_members_log enable row level security;

-- ============================================================
-- 2. Configuración editable (planes, parámetros)
-- ============================================================
-- Una fila por clave (por ahora solo 'plans'). Sin fila se usan los valores
-- por defecto de lib/acti/plans.ts.
create table if not exists acti_config (
  key         text primary key,
  value       jsonb not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);
alter table acti_config enable row level security;

create table if not exists acti_config_log (
  id          uuid primary key default uuid_generate_v4(),
  key         text not null,
  value       jsonb not null,
  changed_by  text,
  changed_at  timestamptz not null default now()
);
create index if not exists acti_config_log_key_idx on acti_config_log (key, changed_at desc);
alter table acti_config_log enable row level security;
