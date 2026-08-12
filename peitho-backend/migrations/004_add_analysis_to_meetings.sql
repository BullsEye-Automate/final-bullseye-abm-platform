-- Peitho — Tarea 5: resultado del análisis post-reunión (Deepgram + Anthropic).

alter table meetings add column if not exists analysis jsonb;
