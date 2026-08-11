-- Peitho — Tarea 2: credenciales OAuth de Google y canales de notificación push
-- (events.watch) sobre el calendario del ejecutivo.

create table if not exists google_credentials (
  id uuid primary key default gen_random_uuid(),
  google_account_email text not null unique,
  access_token text not null,
  refresh_token text not null,
  token_expiry timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un canal por cada vez que se registra events.watch. Google expira los canales
-- periódicamente (semanas/días) — renovarlos automáticamente queda fuera del MVP,
-- por ahora se re-registran manualmente vía POST /calendar/watch.
create table if not exists calendar_watch_channels (
  id uuid primary key default gen_random_uuid(),
  google_credential_id uuid references google_credentials(id) not null,
  calendar_id text not null default 'primary',
  channel_id text not null unique,
  resource_id text not null,
  webhook_token text not null,
  expiration timestamptz,
  sync_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_calendar_watch_channels_channel_id
  on calendar_watch_channels (channel_id);
