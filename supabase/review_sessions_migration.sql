create table if not exists review_sessions (
  id          uuid primary key default uuid_generate_v4(),
  token       uuid not null unique default uuid_generate_v4(),
  client_id   uuid references clients(id),
  client_name text,
  contacts    jsonb not null default '[]',
  created_at  timestamptz default now(),
  expires_at  timestamptz default (now() + interval '7 days')
);

create index if not exists review_sessions_token_idx on review_sessions(token);
