-- BullsEye · Radar ABM (informe ABM integral por cliente)
-- Ver lib/radarAbm/ y la sección "Radar ABM" de CLAUDE.md.
-- Ejecutar en el SQL editor de Supabase (es idempotente).

-- Configuración global: metas y pesos del Health Score, tramos de tamaño,
-- tabla de cargos → área / seniority y mapeo de propiedades de HubSpot
-- (etiqueta → nombre interno). Editable por cualquier usuario interno.
create table if not exists radar_abm_config (
  id          text primary key default 'global',
  config      jsonb not null default '{}'::jsonb,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

-- Configuración por cliente: de qué HubSpot se lee, qué valor de
-- "Cliente BullsEye" define su universo y si el informe se ve en el portal.
create table if not exists radar_abm_clients (
  client_id             uuid primary key references clients(id) on delete cascade,
  hubspot_source        text not null default 'bullseye' check (hubspot_source in ('bullseye', 'client')),
  hubspot_client_value  text,              -- valor de la propiedad "Cliente BullsEye" (vacío = se busca por nombre)
  deep                  boolean,           -- cartera acotada de cuentas estratégicas (vacío = automático)
  pipeline              boolean,           -- el cliente registra negocios (vacío = automático)
  portal_enabled        boolean not null default true,
  updated_by            text,
  updated_at            timestamptz not null default now()
);

-- Última sincronización con HubSpot de cada cliente (el informe completo,
-- con la forma de lib/radarAbm/types.ts → RadarDataset).
create table if not exists radar_abm_snapshots (
  client_id   uuid primary key references clients(id) on delete cascade,
  dataset     jsonb not null,
  synced_at   timestamptz not null default now(),
  synced_by   text,
  warnings    jsonb not null default '[]'::jsonb,
  stats       jsonb not null default '{}'::jsonb
);

alter table radar_abm_config    enable row level security;
alter table radar_abm_clients   enable row level security;
alter table radar_abm_snapshots enable row level security;
