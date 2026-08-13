-- Peitho — research pre-reunión manual (Paso 2 del roadmap frontend, ver
-- CLAUDE.md). Se dispara con un botón "Iniciar research" por reunión, no un
-- cron automático, para no gastar créditos de API en reuniones que no son
-- con un prospecto real.

alter table meetings add column if not exists pre_brief jsonb;
alter table meetings add column if not exists pre_brief_status text not null default 'none'
  check (pre_brief_status in ('none', 'running', 'done', 'failed'));
