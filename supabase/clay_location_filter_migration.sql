-- BullsEye · Migración Clay Location Filter
-- Ejecutar en el SQL editor de Supabase (es idempotente).

alter table clients add column if not exists clay_location_filter text;
