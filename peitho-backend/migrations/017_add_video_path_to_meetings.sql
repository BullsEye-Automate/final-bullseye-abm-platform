-- Fase H (extensión) — video de la reunión, guardado 30 días como respaldo.
-- `video_path` es la ruta en Supabase Storage (bucket "meeting-videos",
-- privado — mismo patrón que "knowledge-base"), no una URL pública directa.
-- Null si la reunión no tiene video (ej. viejas, o si Recall no lo generó).
alter table meetings add column if not exists video_path text;
