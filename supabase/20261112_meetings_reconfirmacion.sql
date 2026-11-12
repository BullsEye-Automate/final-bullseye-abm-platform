-- Reconfirmación de reuniones (piloto Simplex, nov-2026).
-- El SDR marca la reconfirmación en el formulario de registro de reuniones;
-- el Apps Script la guarda en "API Reuniones - IA" (columnas Reconfirmada /
-- Fecha reconfirmación) y el portal la copia aquí (sync de reuniones y cron
-- /api/cron/reconfirmaciones cada 15 min). Ejecutar en Supabase SQL Editor.
-- meetings ya tiene RLS activado (enable_rls_all_tables_migration.sql).

alter table meetings
  add column if not exists reconfirmada    boolean not null default false,
  -- "dd/MM/yyyy HH:mm" (hora de Chile) tal como lo escribe el Apps Script
  add column if not exists reconfirmada_en text,
  -- fecha y hora de la reunión cuando se marcó desde el portal ("YYYY-MM-DD HH:MM"):
  -- si la reunión cambia de fecha u hora, la reconfirmación deja de valer
  add column if not exists reconfirmada_para text;
