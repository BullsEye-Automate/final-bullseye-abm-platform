-- BullsEye · Portal de clientes v4: empresas omitidas
-- Ejecutar en el SQL editor de Supabase (es idempotente).
-- Requiere haber corrido antes client_portal_v3_migration.sql.

-- Empresas que el cliente descartó desde los resultados ("Omitir"): no
-- vuelven a aparecerle en búsquedas ni recomendaciones, pero a diferencia de
-- la lista de exclusión NO se copian a la prospección interna (solo significa
-- "no me interesa verla"). Se pueden restaurar desde "Empresas omitidas".
create table if not exists client_omitted_companies (
  id            uuid primary key default uuid_generate_v4(),
  client_id     uuid not null references clients(id) on delete cascade,
  company_name  text not null,
  domain        text,                 -- normalizado
  linkedin_url  text,
  source        text,                 -- hubspot | lemlist (interno, el cliente no lo ve)
  source_ref    text,
  fit_score     integer,
  fit_reason    text,
  snapshot      jsonb not null default '{}'::jsonb,
  omitted_by    uuid references client_users(id) on delete set null,
  omitted_by_email text,
  created_at    timestamptz not null default now()
);

create index if not exists client_omitted_client_idx on client_omitted_companies (client_id, created_at desc);
create unique index if not exists client_omitted_domain_uidx
  on client_omitted_companies (client_id, domain) where domain is not null;
create unique index if not exists client_omitted_name_uidx
  on client_omitted_companies (client_id, lower(company_name)) where domain is null;

alter table client_omitted_companies enable row level security;
