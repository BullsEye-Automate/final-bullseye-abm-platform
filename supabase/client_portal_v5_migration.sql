-- BullsEye · Portal de clientes v5: recomendaciones IA persistentes
-- Ejecutar en el SQL editor de Supabase (es idempotente).
-- Requiere haber corrido antes client_portal_v4_migration.sql.

-- Recomendaciones IA ya evaluadas (fit >= 60%). Quedan "pending" hasta que el
-- cliente las agregue a su wishlist u omita: así no se pierden al recargar ni
-- se vuelven a pagar evaluaciones.
create table if not exists client_recommendations (
  id            uuid primary key default uuid_generate_v4(),
  client_id     uuid not null references clients(id) on delete cascade,
  source        text not null,          -- hubspot | lemlist (interno)
  source_ref    text not null,
  company_name  text not null,
  domain        text,
  linkedin_url  text,
  facts         jsonb not null default '[]'::jsonb,
  fit_score     integer not null,
  fit_reason    text not null,
  icp_hash      text not null,          -- ICP con que se evaluó (si cambia, no se muestran)
  status        text not null default 'pending' check (status in ('pending', 'added', 'omitted', 'excluded')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (client_id, source, source_ref)
);

create index if not exists client_recommendations_pending_idx
  on client_recommendations (client_id, status, fit_score desc);

alter table client_recommendations enable row level security;

-- Dónde quedó la búsqueda de recomendaciones de cada cliente: "Generar más"
-- continúa desde aquí en vez de volver a evaluar las mismas candidatas.
-- Si cambia el ICP (icp_hash) se parte de cero con filtros nuevos.
create table if not exists client_reco_state (
  client_id   uuid primary key references clients(id) on delete cascade,
  icp_hash    text not null,
  filters     jsonb not null default '{}'::jsonb,
  cursor      jsonb not null default '{}'::jsonb,
  exhausted   boolean not null default false,
  updated_at  timestamptz not null default now()
);

alter table client_reco_state enable row level security;
