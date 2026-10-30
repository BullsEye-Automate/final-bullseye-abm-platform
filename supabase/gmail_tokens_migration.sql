-- Tokens de Gmail por usuario (OAuth 2.0)
create table if not exists user_gmail_tokens (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null unique,          -- auth.users.id
  email text not null,                   -- email de la cuenta Google conectada
  access_token text not null,
  refresh_token text not null,
  token_expiry timestamptz not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table user_gmail_tokens enable row level security;

-- Solo service role accede (las rutas API usan supabaseAdmin)
