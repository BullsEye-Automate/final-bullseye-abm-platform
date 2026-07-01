-- Agregar columna sdr_seleccionado a meeting_feedback
-- Esta columna faltaba y causaba que todos los inserts de feedback fallaran
alter table meeting_feedback
  add column if not exists sdr_seleccionado text;
