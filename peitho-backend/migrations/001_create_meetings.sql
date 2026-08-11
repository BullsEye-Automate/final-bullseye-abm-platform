-- Peitho — Tarea 1: tabla meetings (ver peitho_arquitectura_tecnica_v1.md, sección 0)
-- Registro central del evento de calendario, consumido por la extensión (Flujo 1)
-- y por el job de brief pre-reunión (Flujo 2).

create extension if not exists "pgcrypto";

create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  google_event_id text unique,
  meet_code text,
  ejecutivo text,
  contraparte text,
  empresa_contraparte text,
  start_time timestamptz,
  auto_capture boolean not null default true,
  pre_brief_sent boolean not null default false,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'captured', 'analyzed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- La extensión de Chrome busca por meet_code en cada navegación a meet.google.com/*
create index if not exists idx_meetings_meet_code on meetings (meet_code);

-- El job de brief pre-reunión busca historial previo por el mismo contacto + empresa
create index if not exists idx_meetings_contraparte_empresa
  on meetings (contraparte, empresa_contraparte);
