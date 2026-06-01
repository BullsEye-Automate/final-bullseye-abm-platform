-- BullsEye · Ejemplos aprobados para entrenamiento de estilo
create table if not exists message_examples (
  id            uuid primary key default uuid_generate_v4(),
  client_id     uuid not null references clients(id) on delete cascade,
  contact_name  text,
  job_title     text,
  company_name  text,
  email_subject text not null,
  email_body    text not null,
  icebreaker    text,
  had_reply     boolean default false,
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists message_examples_client_idx on message_examples (client_id);

-- Columnas de guía de estilo en model_training_config
alter table model_training_config
  add column if not exists style_tone         text,
  add column if not exists style_rules        text,
  add column if not exists style_avoid        text,
  add column if not exists style_email_length text default 'corto';
