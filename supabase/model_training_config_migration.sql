CREATE TABLE IF NOT EXISTS model_training_config (
  id                              uuid primary key default gen_random_uuid(),
  is_active                       boolean not null default true,
  business_name                   text,
  business_description            text,
  target_buyer_persona            text,
  language                        text,
  register                        text,
  icebreaker_max_chars            integer,
  subject_max_words               integer,
  body_max_words                  integer,
  forbidden_phrases               jsonb not null default '[]'::jsonb,
  required_phrases                jsonb not null default '[]'::jsonb,
  talking_points                  jsonb not null default '[]'::jsonb,
  value_props                     jsonb not null default '[]'::jsonb,
  strong_decision_maker_keywords  jsonb not null default '[]'::jsonb,
  exclude_role_keywords           jsonb not null default '[]'::jsonb,
  notes                           text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS model_training_config_active_idx ON model_training_config(is_active) WHERE is_active;
DROP TRIGGER IF EXISTS model_training_config_set_updated_at ON model_training_config;
CREATE TRIGGER model_training_config_set_updated_at
  BEFORE UPDATE ON model_training_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
