-- BullsEye · Academia SDR: seguimiento por SDR (SDR → Academia SDR → Seguimiento)
--   - sdr_academy_visits:    cada ingreso de un usuario a la academia de un cliente
--   - sdr_academy_progress:  vueltas completadas por usuario y cliente, puntaje
--                            del quiz y cuándo se avisó por correo a su líder
-- El usuario se identifica por el email de su sesión; el nombre del SDR y su
-- líder se resuelven contra la Maestra IA al registrar.
-- Ejecutar en el SQL editor de Supabase (es idempotente).

create table if not exists sdr_academy_visits (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references clients(id) on delete cascade,
  user_email  text not null,
  sdr_name    text,
  visited_at  timestamptz not null default now()
);

create index if not exists sdr_academy_visits_client_idx on sdr_academy_visits (client_id, user_email, visited_at desc);

create table if not exists sdr_academy_progress (
  client_id           uuid not null references clients(id) on delete cascade,
  user_email          text not null,
  module_no           int  not null check (module_no between 1 and 10),
  sdr_name            text,
  leader_name         text,
  completed           boolean not null default true,
  first_completed_at  timestamptz,
  completed_at        timestamptz,
  quiz_score          int,
  quiz_total          int,
  quiz_attempts       int not null default 0,
  notified_at         timestamptz,       -- correo a la líder (solo la primera vez)
  updated_at          timestamptz not null default now(),
  primary key (client_id, user_email, module_no)
);

alter table sdr_academy_visits enable row level security;
alter table sdr_academy_progress enable row level security;
