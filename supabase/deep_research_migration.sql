-- Agrega columna deep_research a la tabla companies
-- Almacena el resultado del enriquecimiento IA por empresa (JSON stringify)
alter table companies add column if not exists deep_research text default null;
