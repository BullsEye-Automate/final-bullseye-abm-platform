-- Grupos de mensajes: persistencia de generación masiva
create table if not exists message_groups (
  id             uuid primary key default uuid_generate_v4(),
  client_id      uuid references clients(id) on delete cascade,
  name           text not null,
  segment_id     uuid references training_segments(id) on delete set null,
  segment_name   text,
  use_deep_research boolean default false,
  status         text not null default 'generating', -- generating | ready | sent
  total_contacts int  not null default 0,
  generated_count int not null default 0,
  error_count    int  not null default 0,
  sent_count     int  not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists message_group_contacts (
  id             uuid primary key default uuid_generate_v4(),
  group_id       uuid not null references message_groups(id) on delete cascade,
  contact_index  int  not null,
  first_name     text,
  last_name      text,
  email          text,
  phone          text,
  job_title      text,
  company_name   text,
  linkedin_url   text,
  industry       text,
  company_size   text,
  email_subject  text,
  email_body     text,
  email_subject_2 text,
  email_body_2   text,
  email_subject_3 text,
  email_body_3   text,
  connect_message text,
  icebreaker     text,
  linkedin_msg_2 text,
  segment_name   text,
  deep_research_used boolean default false,
  icp_warning    boolean default false,
  status         text not null default 'pending', -- pending | generated | error | cancelled
  error_message  text,
  generated_at   timestamptz,
  sent_at        timestamptz,
  created_at     timestamptz not null default now()
);

-- Índices para consultas frecuentes
create index if not exists message_groups_client_id_idx on message_groups(client_id);
create index if not exists message_groups_status_idx on message_groups(status);
create index if not exists message_group_contacts_group_id_idx on message_group_contacts(group_id);
create index if not exists message_group_contacts_status_idx on message_group_contacts(group_id, status);

-- Constraint único para upsert por group_id + contact_index
alter table message_group_contacts
  drop constraint if exists message_group_contacts_group_contact_unique;
alter table message_group_contacts
  add constraint message_group_contacts_group_contact_unique unique (group_id, contact_index);

-- review_sessions: agregar group_id para leer mensajes en tiempo real
alter table review_sessions
  add column if not exists group_id uuid references message_groups(id) on delete set null;
