-- Sprint 2 — tabla de contactos + feedback de scoring
-- Pega esto en el SQL editor de Supabase y ejecuta.

create table if not exists contacts (
  id                  uuid primary key default uuid_generate_v4(),
  company_id          uuid not null references companies(id) on delete cascade,

  -- Identidad y LinkedIn
  first_name          text,
  last_name           text,
  job_title           text,
  linkedin_headline   text,
  linkedin_url        text,
  email               text,
  phone               text,
  seniority           text,
  tenure              text,

  -- Pre-filter (lo corre la app vía Claude antes de pasar a Clay)
  prefilter_result    text check (prefilter_result in ('yes','no')),
  prefilter_reason    text,

  -- Scoring final (lo devuelve Clay)
  fit_score           integer,
  fit                 text,
  fit_reason          text,
  fit_action          text check (fit_action in ('enrich','manual_review','discard')),

  -- Mensajes generados (los devuelve Clay)
  linkedin_icebreaker text,
  email_subject       text,
  email_body          text,

  -- Estado en el funnel
  status              text not null default 'pending'
                      check (status in ('pending','enriched','contacted','replied','discarded')),

  -- IDs externos para reconciliar
  clay_row_id         text,
  lemlist_lead_id     text,
  hubspot_contact_id  text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists contacts_linkedin_unique
  on contacts (lower(linkedin_url)) where linkedin_url is not null;
create index if not exists contacts_company_idx on contacts (company_id);
create index if not exists contacts_status_idx  on contacts (status);
create index if not exists contacts_score_idx   on contacts (fit_score);

drop trigger if exists contacts_set_updated_at on contacts;
create trigger contacts_set_updated_at
  before update on contacts
  for each row execute function set_updated_at();

create table if not exists contact_feedback (
  id                uuid primary key default uuid_generate_v4(),
  contact_id        uuid references contacts(id) on delete set null,
  company_name      text,
  job_title         text,
  linkedin_headline text,
  company_size      integer,
  claude_score      integer,
  claude_action     text,
  human_action      text not null check (human_action in ('approved','rejected')),
  human_reason      text,
  reviewer          text,
  created_at        timestamptz not null default now()
);

create index if not exists contact_feedback_contact_idx
  on contact_feedback (contact_id);
