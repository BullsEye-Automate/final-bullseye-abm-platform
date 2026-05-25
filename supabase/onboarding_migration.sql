-- BullsEye · Migración wizard de onboarding
-- Ejecutar en el SQL editor de Supabase (es idempotente).

alter table clients
  add column if not exists clay_companies_webhook_url text,
  add column if not exists clay_contacts_webhook_url  text,
  add column if not exists onboarding_step            int         not null default 0,
  add column if not exists onboarding_completed_at    timestamptz,
  add column if not exists status                     text        not null default 'active',
  add column if not exists description                text,
  add column if not exists hubspot_owner_id           text;

-- Índice para filtrar clientes en onboarding
create index if not exists clients_status_idx on clients (status);
