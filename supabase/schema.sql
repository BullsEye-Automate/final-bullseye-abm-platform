-- weCAD4you · Sprint 1 schema
-- Run in Supabase SQL editor in this order.

create extension if not exists "uuid-ossp";

-- ICP versionable. Cada edición crea una nueva fila (audit trail).
create table if not exists icp_config (
  id              uuid primary key default uuid_generate_v4(),
  version         integer not null,
  is_active       boolean not null default false,
  -- Filtro 1: tipos de organización aceptados (lab, multi_clinic, dso, etc.)
  org_types       jsonb not null default '[]'::jsonb,
  -- Filtro 2: señales digitales (strong / medium / not_enough)
  signals_strong  jsonb not null default '[]'::jsonb,
  signals_medium  jsonb not null default '[]'::jsonb,
  signals_weak    jsonb not null default '[]'::jsonb,
  -- Filtro 3: reglas de volumen (rangos de empleados + decisión)
  size_rules      jsonb not null default '[]'::jsonb,
  -- Mix recomendado por tamaño
  pipeline_mix    jsonb not null default '[]'::jsonb,
  -- Competidores a monitorear (señal de fit inmediata)
  competitors     jsonb not null default '[]'::jsonb,
  -- Geografías (priority: principal / secundario / terciario / oportunístico)
  geographies     jsonb not null default '[]'::jsonb,
  -- Notas libres (no se inyectan al prompt como variables, sólo referencia)
  notes           text default '',
  created_by      text,
  created_at      timestamptz not null default now()
);

create unique index if not exists icp_config_active_unique
  on icp_config (is_active) where is_active = true;

-- Empresas descubiertas o aprobadas
create table if not exists companies (
  id                   uuid primary key default uuid_generate_v4(),
  company_name         text not null,
  company_website      text,
  company_linkedin_url text,
  company_city         text,
  company_country      text,
  company_size         integer,
  company_type         text check (company_type in ('lab','multi_clinic','dso','other')),
  cad_software         text,
  scanner_technology   text,
  fit_signals          text,
  fit_score            text check (fit_score in ('high','medium','low')),
  -- Razonamiento generado por Claude + fuentes Perplexity
  research_summary     text,
  research_sources     jsonb default '[]'::jsonb,
  competitor_match     text,
  status               text not null default 'pending'
                       check (status in ('pending','approved','rejected')),
  reject_reason        text,
  approved_by          text,
  approved_at          timestamptz,
  icp_version          integer,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists companies_name_unique
  on companies (lower(company_name));

create index if not exists companies_status_idx on companies (status);

-- Feedback humano sobre cada decisión (alimenta el loop de entrenamiento)
create table if not exists company_feedback (
  id            uuid primary key default uuid_generate_v4(),
  company_id    uuid not null references companies(id) on delete cascade,
  reviewer      text not null,
  decision      text not null check (decision in ('approved','rejected')),
  reason        text,
  ai_fit_score  text,
  ai_fit_signals text,
  icp_version   integer,
  created_at    timestamptz not null default now()
);

create index if not exists company_feedback_company_idx
  on company_feedback (company_id);

-- Trigger updated_at
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists companies_set_updated_at on companies;
create trigger companies_set_updated_at
  before update on companies
  for each row execute function set_updated_at();
