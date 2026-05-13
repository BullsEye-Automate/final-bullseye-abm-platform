-- Sprint 5 fase 2 — tabla de llamadas + análisis Claude
-- Pega esto en el SQL editor de Supabase y ejecuta. Idempotente.

create table if not exists calls (
  id                          uuid primary key default uuid_generate_v4(),

  -- Identificadores HubSpot
  hubspot_call_id             text not null unique,
  hubspot_contact_id          text,
  hubspot_company_id          text,
  hubspot_owner_id            text,
  owner_name                  text,

  -- Joins a nuestra DB (resueltos en sync por hubspot_*_id)
  contact_id                  uuid references contacts(id) on delete set null,
  company_id                  uuid references companies(id) on delete set null,

  -- Datos de la llamada
  call_timestamp              timestamptz,
  direction                   text,                  -- INBOUND / OUTBOUND
  duration_ms                 bigint,
  disposition_id              text,                  -- HubSpot disposition GUID
  disposition_label           text,                  -- Resuelto a label legible
  status                      text,                  -- COMPLETED, MISSED, etc.
  call_title                  text,
  body                        text,                  -- Notas escritas del SDR (hs_call_body)
  recording_url               text,
  transcription               text,
  has_transcription           boolean not null default false,

  -- Análisis Claude (poblado por /api/calls/[id]/analyze o auto on sync)
  analyzed_at                 timestamptz,
  analysis_model              text,
  analysis_error              text,

  -- Respuesta del cliente
  customer_response_category  text,                  -- key estable (ver lib/callAnalyzer.ts)
  customer_response_label     text,                  -- label en español
  customer_response_summary   text,                  -- 1-2 frases en español

  -- Evaluación del SDR (escala 0-10)
  sdr_score_overall           numeric(4,1),
  sdr_score_opening           numeric(4,1),
  sdr_score_discovery         numeric(4,1),
  sdr_score_objection         numeric(4,1),
  sdr_score_next_step         numeric(4,1),

  -- Detalle cualitativo
  sdr_strengths               jsonb,                 -- string[]
  sdr_improvements            jsonb,                 -- {area, suggestion, example_quote}[]
  recommended_next_step       text,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists calls_timestamp_idx   on calls (call_timestamp desc);
create index if not exists calls_owner_idx       on calls (hubspot_owner_id);
create index if not exists calls_disposition_idx on calls (disposition_id);
create index if not exists calls_contact_idx     on calls (contact_id);
create index if not exists calls_company_idx     on calls (company_id);
create index if not exists calls_response_idx    on calls (customer_response_category);

drop trigger if exists calls_set_updated_at on calls;
create trigger calls_set_updated_at
  before update on calls
  for each row execute function set_updated_at();
