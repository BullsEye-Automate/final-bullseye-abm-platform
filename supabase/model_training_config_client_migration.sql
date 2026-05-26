-- Asocia model_training_config a un cliente específico (multi-tenant).
-- Los registros con client_id NULL siguen funcionando como configuración global fallback.
ALTER TABLE model_training_config ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id);
CREATE INDEX IF NOT EXISTS model_training_config_client_idx ON model_training_config(client_id);
