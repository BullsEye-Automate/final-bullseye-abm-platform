-- Migración: columnas adicionales para sync con Google Sheets
-- Ejecutar en Supabase SQL Editor

alter table meetings
  add column if not exists origen          text,
  add column if not exists responsable     text,
  add column if not exists fecha_agendamiento date,
  add column if not exists hora            text,
  add column if not exists pais            text,
  add column if not exists propuesta_oportunidad text,
  add column if not exists sales_manager   text,
  add column if not exists telefono        text,
  add column if not exists correo          text,
  add column if not exists industria       text,
  add column if not exists hora_formulario text,
  -- Identificador externo para evitar duplicados en sync
  add column if not exists sheet_row_key   text unique;

create index if not exists meetings_sheet_row_key_idx on meetings (sheet_row_key);
