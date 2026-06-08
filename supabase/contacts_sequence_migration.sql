-- Agrega columnas de secuencia completa a la tabla contacts
-- Email 2 y 3 (follow-ups)
alter table contacts
  add column if not exists email_subject_2   text,
  add column if not exists email_body_2      text,
  add column if not exists email_subject_3   text,
  add column if not exists email_body_3      text,
  -- Mensaje de invitación a conectar en LinkedIn
  add column if not exists connect_message   text,
  -- Mensajes de LinkedIn post-conexión (el primero ya existe como linkedin_icebreaker)
  add column if not exists linkedin_msg_2    text;
