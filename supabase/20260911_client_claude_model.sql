-- Modelo de Claude por cliente (null = usa el default global Sonnet 4.6)
alter table client_configs
  add column if not exists claude_model text
  check (claude_model is null or claude_model = 'claude-haiku-4-5-20251001');
