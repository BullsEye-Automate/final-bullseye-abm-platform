-- Peitho — Tarea 4: la extensión sube el audio capturado, se guarda la ruta local
-- del archivo. status pasa a 'captured' (la transcripción/análisis es la Tarea 5).

alter table meetings add column if not exists audio_path text;
