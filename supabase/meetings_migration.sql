-- Migración: módulo Oportunidades (meetings + feedback)
-- Ejecutar en Supabase SQL Editor

-- Tabla de reuniones (importadas desde Excel o creadas manualmente)
create table if not exists meetings (
  id                uuid primary key default uuid_generate_v4(),
  client_id         uuid references clients(id) on delete cascade,
  empresa           text not null,
  contacto_nombre   text,
  contacto_cargo    text,
  contacto_empresa  text,
  fecha_reunion     date,
  realizado         text default 'Pendiente'
                    check (realizado in ('Si', 'No', 'Pendiente', 'Reagendar')),
  notas             text,
  sdr_nombre        text,
  -- Token único para URL de encuesta pública
  feedback_token    text unique default encode(gen_random_bytes(24), 'hex'),
  feedback_status   text default 'pendiente'
                    check (feedback_status in ('pendiente', 'con_feedback')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists meetings_client_idx on meetings (client_id);
create index if not exists meetings_fecha_idx on meetings (fecha_reunion desc);
create index if not exists meetings_token_idx on meetings (feedback_token);

drop trigger if exists meetings_set_updated_at on meetings;
create trigger meetings_set_updated_at
  before update on meetings
  for each row execute function set_updated_at();

-- Tabla de respuestas de encuesta de feedback
create table if not exists meeting_feedback (
  id                        uuid primary key default uuid_generate_v4(),
  meeting_id                uuid not null references meetings(id) on delete cascade unique,
  calificacion              integer check (calificacion between 1 and 10),
  empresa_calificada        boolean,
  contacto_calificado       boolean,
  razon_no_califica         text
                            check (razon_no_califica in (
                              'No tomaba decisiones',
                              'No presentó interés',
                              'No tenía contexto de nosotros',
                              'Tomó la reunión desde el celular',
                              'Otro'
                            )),
  razon_no_califica_otro    text,
  propuesta_comercial       text
                            check (propuesta_comercial in (
                              'Si',
                              'No',
                              'No aún',
                              'Falta otra reunión'
                            )),
  comentarios_adicionales   text,
  submitted_at              timestamptz not null default now()
);

create index if not exists meeting_feedback_meeting_idx on meeting_feedback (meeting_id);
