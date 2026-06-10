-- Configuración de secuencia de outreach por segmento
alter table training_segments
  add column if not exists email_count          integer not null default 3,
  add column if not exists linkedin_msg_count   integer not null default 2,
  add column if not exists include_connect_msg  boolean not null default true;
