-- BullsEye · Columnas faltantes para funnel y dashboard
alter table contacts
  add column if not exists lemlist_pushed_at timestamptz,
  add column if not exists source            text check (source in ('clay','sales_navigator')),
  add column if not exists human_decision    text check (human_decision in ('approved','rejected')),
  add column if not exists phone_source      text check (phone_source in ('lusha','lemlist'));

create index if not exists contacts_lemlist_pushed_idx on contacts (lemlist_pushed_at);
create index if not exists contacts_source_idx on contacts (source);

alter table companies
  add column if not exists hubspot_company_id  text,
  add column if not exists hubspot_synced_at   timestamptz,
  add column if not exists hubspot_sync_error  text;

create index if not exists companies_hubspot_idx on companies (hubspot_company_id);
