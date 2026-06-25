-- Agregar columna probabilidad_cierre a meeting_feedback
alter table meeting_feedback
  add column if not exists probabilidad_cierre integer check (probabilidad_cierre >= 0 and probabilidad_cierre <= 100);
