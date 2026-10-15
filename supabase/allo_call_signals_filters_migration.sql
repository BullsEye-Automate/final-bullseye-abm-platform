-- BullsEye · Filtros para señales comerciales (industria + tecnologías)
-- Agrega columnas a allo_call_signals para poder filtrar por industria del
-- prospecto y ver qué tecnologías dijo usar. "categoria" dentro del jsonb
-- `signals` pasa de texto libre a un enum fijo de 8 valores (ver
-- lib/alloCallSignals.ts: CALL_SIGNAL_CATEGORIES) — no requiere migración de
-- datos porque no se valida a nivel de Postgres, solo en el código que
-- escribe/lee la columna.
-- Ejecutar en el SQL editor de Supabase (es idempotente).

alter table allo_call_signals
  add column if not exists industry text,
  add column if not exists mentioned_technologies jsonb not null default '[]'::jsonb;

create index if not exists allo_call_signals_industry_idx
  on allo_call_signals (industry);
