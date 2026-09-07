-- Tabla para múltiples campañas Lemlist por cliente
create table if not exists client_lemlist_campaigns (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade not null,
  campaign_id text not null,
  campaign_name text,
  is_active boolean default true,
  created_at timestamptz default now(),
  unique (client_id, campaign_id)
);

create index if not exists idx_client_lemlist_campaigns_client
  on client_lemlist_campaigns(client_id);
