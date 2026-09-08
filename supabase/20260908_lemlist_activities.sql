-- Actividades de Lemlist sincronizadas localmente para filtros de fecha exactos
create table if not exists lemlist_activities (
  id            text primary key,                              -- _id de Lemlist
  client_id     uuid references clients(id) on delete cascade not null,
  campaign_id   text not null,
  campaign_name text,
  type          text not null,                                 -- emailsOpened, emailsReplied, etc.
  lead_email    text,
  lead_first_name  text,
  lead_last_name   text,
  lead_company_name text,
  created_at    timestamptz,
  synced_at     timestamptz default now()
);

create index if not exists lemlist_activities_client_type_date
  on lemlist_activities (client_id, type, created_at desc);
create index if not exists lemlist_activities_campaign
  on lemlist_activities (campaign_id);

-- Leads sincronizados para conteo de "enviados"
create table if not exists lemlist_leads_synced (
  id            text primary key,                              -- _id de Lemlist
  client_id     uuid references clients(id) on delete cascade not null,
  campaign_id   text not null,
  campaign_name text,
  synced_at     timestamptz default now()
);

create index if not exists lemlist_leads_synced_client_campaign
  on lemlist_leads_synced (client_id, campaign_id);

-- Timestamp de última sincronización por cliente
create table if not exists lemlist_sync_log (
  client_id   uuid primary key references clients(id) on delete cascade,
  last_synced_at timestamptz,
  leads_count    int,
  activities_count int
);
