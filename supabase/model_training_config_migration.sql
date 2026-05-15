-- Sprint 9 — Configuración del modelo de mensajes IA.
--
-- Permite al equipo iterar el copy generado por messageGenerator sin
-- tocar código. Una sola fila activa a la vez (is_active=true). Si la
-- fila no existe o todos los campos están vacíos, messageGenerator
-- usa los defaults hardcodeados (comportamiento actual).
--
-- Campos:
--   language               : "en" | "es" | "mix" | null (default: en)
--   register               : "formal" | "casual" | "peer_industry" | null
--   icebreaker_max_chars   : entero o null (default: 180)
--   subject_max_words      : entero o null (default: 7)
--   body_max_words         : entero o null (default: sin tope)
--   forbidden_phrases      : array de strings a EVITAR en el copy
--   required_phrases       : array de strings que SIEMPRE mencionar
--                            (cuando son relevantes)
--   talking_points         : array de { role, company_type, points }
--                            con guidelines por combinación rol × tipo
--                            de empresa. role="any" / company_type="any"
--                            funcionan como fallback.
--   value_props            : array ordenado de propuestas de valor de
--                            weCAD4you. La IA usa el orden como
--                            prioridad cuando tiene que elegir cuál
--                            mencionar.
--   notes                  : texto libre con contexto adicional para
--                            la IA (instrucciones generales del equipo).
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS model_training_config (
  id                     uuid primary key default gen_random_uuid(),
  is_active              boolean not null default true,
  language               text,
  register               text,
  icebreaker_max_chars   integer,
  subject_max_words      integer,
  body_max_words         integer,
  forbidden_phrases      jsonb not null default '[]'::jsonb,
  required_phrases       jsonb not null default '[]'::jsonb,
  talking_points         jsonb not null default '[]'::jsonb,
  value_props            jsonb not null default '[]'::jsonb,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS model_training_config_active_idx
  ON model_training_config(is_active) WHERE is_active;

-- Trigger para mantener updated_at fresco automáticamente.
DROP TRIGGER IF EXISTS model_training_config_set_updated_at ON model_training_config;
CREATE TRIGGER model_training_config_set_updated_at
  BEFORE UPDATE ON model_training_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
