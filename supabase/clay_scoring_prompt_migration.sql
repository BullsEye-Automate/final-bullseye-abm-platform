-- Columna para guardar el prompt de Clay Lead Scoring generado por IA
alter table clients add column if not exists clay_scoring_prompt text default null;
