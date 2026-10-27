-- BullsEye · Radar ABM — mapeo de propiedades por cliente.
-- Cuando el Radar de un cliente se lee de su HubSpot propio, los nombres
-- internos de sus propiedades pueden ser distintos a los del HubSpot de
-- BullsEye: se guardan acá (clave del Radar → nombre interno). Vacío = se
-- detectan por etiqueta. Requiere 20261026_radar_abm_migration.sql.
-- Ejecutar en el SQL editor de Supabase (es idempotente).
alter table radar_abm_clients add column if not exists properties jsonb not null default '{}'::jsonb;
