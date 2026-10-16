-- BullsEye · Módulo Células SDR (Análisis → Células SDR)
-- Parámetros de "Configurar" del dashboard (umbrales del semáforo, metas
-- diarias de actividad, objetivos de conexión / asistencia / oportunidad,
-- tope de sobrecumplimiento, meta y rangos de puntaje de llamadas, valores
-- de Propuesta/Oportunidad que cuentan como oportunidad y peso por
-- cliente). Son globales: todos los usuarios ven la misma información y
-- cualquier usuario con sesión puede editarlos.
-- Las metas de reuniones NO se guardan acá: se leen siempre de la pestaña
-- "Asignación" de la planilla de metas.
-- Ejecutar en el SQL editor de Supabase (es idempotente).

create table if not exists sdr_cells_config (
  id          text primary key default 'global',
  config      jsonb not null default '{}'::jsonb,
  updated_by  text,
  updated_at  timestamptz not null default now()
);
