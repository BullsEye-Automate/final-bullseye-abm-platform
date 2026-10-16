-- BullsEye · Portal de clientes (fase 1: accesos + propuestas de ICP)
-- Ejecutar en el SQL editor de Supabase (es idempotente).

-- ============================================================
-- 1. Usuarios del portal (varios por cliente, sin límite)
-- ============================================================
-- Cada fila vincula un usuario de Supabase Auth a UN cliente. Es la fuente
-- de verdad para autorizar las APIs de /api/portal/*. Además, al crear el
-- usuario se setea app_metadata.role = 'client' para que el middleware lo
-- confine a /portal sin consultar la base en cada request.

create table if not exists client_users (
  id            uuid primary key default uuid_generate_v4(),
  auth_user_id  uuid not null unique references auth.users(id) on delete cascade,
  client_id     uuid not null references clients(id) on delete cascade,
  email         text not null,
  full_name     text,
  is_active     boolean not null default true,
  created_by    text,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists client_users_client_idx on client_users (client_id);

-- Solo el service role accede (las APIs usan supabaseAdmin). RLS activo y
-- sin policies = nadie más puede leer la tabla con la anon key.
alter table client_users enable row level security;

-- ============================================================
-- 2. Propuestas de cambio de ICP (requieren aprobación BullsEye)
-- ============================================================
-- El cliente nunca edita el ICP directo desde el portal: cada envío crea
-- (o actualiza, si ya hay una pendiente) una propuesta. Al aprobarla, el
-- contenido se copia a client_ai_context (ICP general) o a
-- icp_industry_sections (ICP por industria).

create table if not exists icp_change_requests (
  id                uuid primary key default uuid_generate_v4(),
  client_id         uuid not null references clients(id) on delete cascade,
  industry_id       uuid references icp_industries(id) on delete cascade,
  previous_content  text not null default '',
  proposed_content  text not null,
  client_comment    text,
  status            text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected')),
  submitted_by      uuid references client_users(id) on delete set null,
  submitted_by_email text,
  review_note       text,
  reviewed_by       text,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists icp_change_requests_status_idx
  on icp_change_requests (status, created_at desc);
create index if not exists icp_change_requests_client_idx
  on icp_change_requests (client_id, created_at desc);

-- Una sola propuesta pendiente por cliente + industria (null = ICP general)
create unique index if not exists icp_change_requests_one_pending
  on icp_change_requests (client_id, coalesce(industry_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'pending';

alter table icp_change_requests enable row level security;
