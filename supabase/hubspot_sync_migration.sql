alter table contacts
  add column if not exists hubspot_synced_at  timestamptz,
  add column if not exists hubspot_sync_error text;
create index if not exists contacts_hubspot_synced_at_idx on contacts (hubspot_synced_at);

alter table companies
  add column if not exists hubspot_company_id text,
  add column if not exists hubspot_synced_at  timestamptz,
  add column if not exists hubspot_sync_error text;
create index if not exists companies_hubspot_synced_at_idx on companies (hubspot_synced_at);
