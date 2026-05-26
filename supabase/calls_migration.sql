-- Migración: tabla de llamadas sincronizadas desde HubSpot con análisis IA
create table if not exists calls (
  id                    uuid primary key default uuid_generate_v4(),
  client_id             uuid references clients(id),
  hubspot_call_id       text not null unique,
  contact_name          text,
  company_name          text,
  direction             text check (direction in ('OUTBOUND','INBOUND')),
  duration_ms           bigint,
  disposition           text,
  disposition_label     text,
  notes_raw             text,
  notes_clean           text,
  called_at             timestamptz,
  hubspot_owner_id      text,
  sdr_name              text,
  -- Análisis IA
  ai_score              integer check (ai_score between 1 and 10),
  ai_outcome            text,
  ai_outcome_detail     text,
  ai_is_real_conversation boolean default false,
  ai_summary            text,
  ai_next_steps         text,
  analyzed_at           timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists calls_client_id_idx on calls(client_id);
create index if not exists calls_called_at_idx on calls(called_at desc);
create index if not exists calls_hubspot_id_idx on calls(hubspot_call_id);
