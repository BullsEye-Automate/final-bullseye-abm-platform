-- Agregar columna user_id a ai_usage_log para tracking por usuario
alter table ai_usage_log
add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists ai_usage_log_user_id_idx on ai_usage_log(user_id);
