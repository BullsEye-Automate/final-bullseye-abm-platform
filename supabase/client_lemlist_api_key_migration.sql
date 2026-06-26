-- Agregar columna lemlist_api_key a client_configs
-- Permite configurar una API key de Lemlist por cliente (si está vacía, se usa la cuenta BullsEye)
alter table client_configs add column if not exists lemlist_api_key text;
