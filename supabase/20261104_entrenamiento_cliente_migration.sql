-- BullsEye · Entrenamiento cliente (SDR → Entrenamiento cliente), antes "Academia SDR".
-- El entrenamiento ya no se genera con IA en la app: es la academia HTML que
-- se arma con el skill "academia-sdr-bullseye" en el proyecto de Claude de
-- cada cliente. Las que ya existían vienen en el repo (content/entrenamiento/);
-- las nuevas o actualizadas se suben desde Configurar y se guardan aquí
-- (si hay una subida, manda sobre la del repo).
-- sdr_academy_modules (generación con IA) queda sin uso; no se borra.
-- Ejecutar en el SQL editor de Supabase (es idempotente).

alter table sdr_academies add column if not exists html        text;
alter table sdr_academies add column if not exists title       text;
alter table sdr_academies add column if not exists source_url  text;
alter table sdr_academies add column if not exists uploaded_by text;
alter table sdr_academies add column if not exists uploaded_at timestamptz;
