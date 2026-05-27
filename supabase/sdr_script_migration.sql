-- Agrega columna sdr_script a la tabla contacts
-- Ejecutar una vez en el SQL Editor de Supabase

alter table contacts
  add column if not exists sdr_script text;
