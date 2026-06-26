-- BullsEye · ICP por industria
-- Ejecutar en el SQL editor de Supabase (es idempotente).

-- ============================================================
-- 1. Agregar icp_mode a client_configs
-- ============================================================

alter table client_configs
  add column if not exists icp_mode text default 'general'
    check (icp_mode in ('general', 'by_industry'));

-- ============================================================
-- 2. Tabla de industrias por cliente
-- ============================================================

create table if not exists icp_industries (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid not null references clients(id) on delete cascade,
  name       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists icp_industries_client_idx
  on icp_industries (client_id, sort_order);

-- ============================================================
-- 3. Tabla de secciones ICP por industria
-- ============================================================
-- section_key: target_company | fit_signals | buyer_persona |
--              value_prop | outreach | reference_clients
-- content: texto serializado con el mismo formato que client_ai_context
-- copied_from_industry_id: id de la industria de la que se copió (solo registro, no vínculo vivo)

create table if not exists icp_industry_sections (
  id                       uuid primary key default uuid_generate_v4(),
  industry_id              uuid not null references icp_industries(id) on delete cascade,
  section_key              text not null,
  content                  text not null default '',
  copied_from_industry_id  uuid references icp_industries(id) on delete set null,
  updated_at               timestamptz not null default now()
);

create unique index if not exists icp_industry_sections_unique
  on icp_industry_sections (industry_id, section_key);

drop trigger if exists icp_industry_sections_set_updated_at on icp_industry_sections;
create trigger icp_industry_sections_set_updated_at
  before update on icp_industry_sections
  for each row execute function set_updated_at();
