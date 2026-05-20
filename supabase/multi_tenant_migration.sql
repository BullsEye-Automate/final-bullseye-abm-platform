-- BullsEye · Arquitectura multi-tenant
-- Ejecutar en el SQL editor de Supabase (es idempotente).

-- ============================================================
-- 1. Tabla de clientes
-- ============================================================

create table if not exists clients (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  slug       text not null unique,
  logo_url   text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists clients_set_updated_at on clients;
create trigger clients_set_updated_at
  before update on clients
  for each row execute function set_updated_at();

-- ============================================================
-- 2. Configuración por cliente (IDs de Lemlist, Clay, HubSpot)
-- ============================================================

create table if not exists client_configs (
  id                          uuid primary key default uuid_generate_v4(),
  client_id                   uuid not null references clients(id) on delete cascade,
  lemlist_campaign_id         text,
  lemlist_staging_campaign_id text,
  clay_companies_table_id     text,
  clay_contacts_table_id      text,
  hubspot_pipeline_id         text,
  hubspot_owner_id            text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (client_id)
);

drop trigger if exists client_configs_set_updated_at on client_configs;
create trigger client_configs_set_updated_at
  before update on client_configs
  for each row execute function set_updated_at();

-- ============================================================
-- 3. Contexto IA por cliente (ICPs, one pagers, presentaciones)
-- ============================================================

create table if not exists client_ai_context (
  id           uuid primary key default uuid_generate_v4(),
  client_id    uuid not null references clients(id) on delete cascade,
  file_name    text not null,
  file_type    text,
  content      text,
  storage_path text,
  uploaded_at  timestamptz not null default now()
);

create index if not exists client_ai_context_client_idx
  on client_ai_context (client_id);

-- ============================================================
-- 4. Agregar client_id a tablas existentes
-- ============================================================

alter table companies
  add column if not exists client_id uuid references clients(id);

alter table contacts
  add column if not exists client_id uuid references clients(id);

alter table icp_config
  add column if not exists client_id uuid references clients(id);

-- Índices de búsqueda por client_id
create index if not exists companies_client_idx on companies (client_id);
create index if not exists contacts_client_idx  on contacts  (client_id);
create index if not exists icp_config_client_idx on icp_config (client_id);

-- ============================================================
-- 5. Actualizar índices únicos para que sean por cliente
--    (en multi-tenant el mismo nombre/linkedin puede aparecer
--     en distintos clientes)
-- ============================================================

-- companies: nombre único dentro del mismo cliente
drop index if exists companies_name_unique;
create unique index if not exists companies_client_name_unique
  on companies (client_id, lower(company_name))
  where client_id is not null;

-- contacts: linkedin único dentro del mismo cliente
drop index if exists contacts_linkedin_unique;
create unique index if not exists contacts_client_linkedin_unique
  on contacts (client_id, lower(linkedin_url))
  where client_id is not null and linkedin_url is not null;

-- icp_config: solo un ICP activo por cliente
drop index if exists icp_config_active_unique;
create unique index if not exists icp_config_client_active_unique
  on icp_config (client_id)
  where is_active = true;
