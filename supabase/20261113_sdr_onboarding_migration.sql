-- Onboarding SDR (90 días) — un registro por SDR (por su correo corporativo).
-- Ver CLAUDE.md → "Onboarding SDR" y lib/onboardingSdr/.

create table if not exists sdr_onboardings (
  id uuid primary key default gen_random_uuid(),
  sdr_email text not null unique,          -- correo de la sesión del SDR (minúsculas)
  sdr_name text,                           -- nombre según la Maestra IA (o el que se escribió al crearlo)
  leader_name text,                        -- líder de su célula según la Maestra IA
  ingreso date,                            -- día 1
  clientes text[] not null default '{}',   -- ids de clientes de la app (cliente 1 y 2)
  hechos jsonb not null default '{}'::jsonb,  -- hito → { at, by (rol), email }
  valida jsonb not null default '{}'::jsonb,  -- confirmaciones de doble verificación
  etapas jsonb not null default '{}'::jsonb,  -- etapas confirmadas por la líder
  is_active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Historial de cada cambio (quién, con qué rol, qué hizo).
create table if not exists sdr_onboarding_log (
  id bigserial primary key,
  onboarding_id uuid not null references sdr_onboardings(id) on delete cascade,
  actor_email text not null,
  actor_role text not null,
  op jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists sdr_onboarding_log_onb_idx on sdr_onboarding_log (onboarding_id, created_at desc);

alter table sdr_onboardings enable row level security;
alter table sdr_onboarding_log enable row level security;
