-- BullsEye · Migración wizard de onboarding
-- Ejecutar en el SQL editor de Supabase (es idempotente).
-- Cada ADD COLUMN necesita su propio IF NOT EXISTS en PostgreSQL.

alter table clients add column if not exists clay_companies_webhook_url text;
alter table clients add column if not exists clay_contacts_webhook_url  text;
alter table clients add column if not exists onboarding_step            int  not null default 0;
alter table clients add column if not exists onboarding_completed_at    timestamptz;
alter table clients add column if not exists status                     text not null default 'active';
alter table clients add column if not exists description                text;
alter table clients add column if not exists hubspot_owner_id           text;

-- Índice para filtrar clientes en onboarding
create index if not exists clients_status_idx on clients (status);
