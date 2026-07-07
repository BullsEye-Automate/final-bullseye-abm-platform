create table if not exists ai_usage_log (
  id            uuid primary key default uuid_generate_v4(),
  created_at    timestamptz default now(),
  client_id     uuid references clients(id) on delete set null,
  function_name text not null,
  model         text not null,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  cost_usd      numeric(10,6) not null default 0,
  metadata      jsonb
);

create index if not exists ai_usage_log_created_at_idx on ai_usage_log(created_at desc);
create index if not exists ai_usage_log_client_id_idx  on ai_usage_log(client_id);
