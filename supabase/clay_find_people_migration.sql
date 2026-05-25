-- BullsEye · Migración Clay Find People config
-- Ejecutar en el SQL editor de Supabase (es idempotente).

alter table clients add column if not exists clay_find_people_titles  text;
alter table clients add column if not exists clay_find_people_keywords text;
alter table clients add column if not exists clay_excluded_titles      text;
