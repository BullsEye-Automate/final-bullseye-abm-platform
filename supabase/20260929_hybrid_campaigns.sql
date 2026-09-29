create table if not exists hybrid_campaigns (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade not null,
  name text not null,
  lemlist_campaign_id text,
  lemlist_campaign_name text,
  contacts jsonb default '[]'::jsonb,
  matrix jsonb,
  status text default 'draft',   -- draft | generated | sent
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists hybrid_campaigns_client_id_idx on hybrid_campaigns(client_id);
