-- BullsEye · Contactos de la wishlist con IA (prueba)
-- Ejecutar en el SQL editor de Supabase (es idempotente).
-- Requiere haber corrido antes client_wishlist_migration.sql.
--
-- Flujo: por cada empresa de la wishlist se buscan sus empleados en la base de
-- personas de Lemlist (key del cliente), la IA puntúa los cargos contra el ICP
-- y buyer persona, y los mejores (máx. 8) quedan "suggested" para que
-- prospección los apruebe o rechace. Al aprobar se crean en el Lemlist del
-- cliente y se pide email + teléfono (créditos de Lemlist).

-- ============================================================
-- 1. Estado de la búsqueda de contactos en cada empresa solicitada
-- ============================================================
alter table client_wishlist add column if not exists contacts_status text not null default 'pending';
alter table client_wishlist drop constraint if exists client_wishlist_contacts_status_check;
alter table client_wishlist add constraint client_wishlist_contacts_status_check
  check (contacts_status in ('pending', 'done', 'few_contacts', 'error'));
alter table client_wishlist add column if not exists contacts_found integer not null default 0;
alter table client_wishlist add column if not exists contacts_searched_at timestamptz;
alter table client_wishlist add column if not exists contacts_error text;
alter table client_wishlist add column if not exists contacts_debug jsonb;   -- intentos de búsqueda (diagnóstico)

-- ============================================================
-- 2. Contactos sugeridos por la IA (revisión humana)
-- ============================================================
create table if not exists wishlist_contacts (
  id                 uuid primary key default uuid_generate_v4(),
  client_id          uuid not null references clients(id) on delete cascade,
  wishlist_id        uuid not null references client_wishlist(id) on delete cascade,
  lead_id            text not null,                 -- id de la base de personas de Lemlist
  full_name          text not null,
  first_name         text,
  last_name          text,
  title              text,
  linkedin_url       text,
  location           text,
  seniority          text,
  department         text,
  fit_score          integer not null,
  buying_role        text,                          -- decisor | influenciador | usuario
  fit_reason         text,
  status             text not null default 'suggested' check (status in ('suggested', 'approved', 'rejected')),
  reject_reason      text,
  reviewed_by_email  text,
  reviewed_at        timestamptz,
  lemlist_contact_id text,                          -- ctc_xxx en el Lemlist del cliente
  lemlist_error      text,
  enrich_id          text,                          -- enr_xxx (email + teléfono)
  enrich_status      text not null default 'none' check (enrich_status in ('none', 'pending', 'done', 'error')),
  email              text,
  phone              text,
  enrich_raw         jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (wishlist_id, lead_id)
);

create index if not exists wishlist_contacts_client_idx on wishlist_contacts (client_id, status, created_at desc);
alter table wishlist_contacts enable row level security;

-- ============================================================
-- 3. Caché de la IA
-- ============================================================
-- Puntaje por CARGO (no por persona): un mismo cargo se evalúa una sola vez
-- por cliente + versión del buyer persona (incluye el aprendizaje de las
-- revisiones), así una empresa con miles de empleados no multiplica el costo.
create table if not exists persona_title_scores (
  client_id     uuid not null references clients(id) on delete cascade,
  persona_hash  text not null,
  title_norm    text not null,
  fit_score     integer not null,
  buying_role   text,
  fit_reason    text,
  created_at    timestamptz not null default now(),
  primary key (client_id, persona_hash, title_norm)
);
alter table persona_title_scores enable row level security;

-- Pre-filtro de Lemlist (seniority / área) derivado del buyer persona, para
-- empresas grandes
create table if not exists client_persona_filters (
  client_id     uuid primary key references clients(id) on delete cascade,
  persona_hash  text not null,
  filters       jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);
alter table client_persona_filters enable row level security;
