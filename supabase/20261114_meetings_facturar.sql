-- Dashboard SDR: marca "Para facturar" por reunión, con trazabilidad (quién
-- y cuándo), para que facturación vea qué reuniones cobrar a cada cliente.
-- Vive en la tabla meetings: el sync de la planilla hace upsert por
-- sheet_row_key y no toca estas columnas, así que se conservan mientras la
-- reunión tenga "ID Reunión" en la planilla.
alter table meetings add column if not exists facturar boolean not null default false;
alter table meetings add column if not exists facturar_by text;
alter table meetings add column if not exists facturar_at timestamptz;
create index if not exists meetings_facturar_idx on meetings (facturar) where facturar;
-- meetings ya tiene RLS activado (supabase/enable_rls_all_tables_migration.sql)
