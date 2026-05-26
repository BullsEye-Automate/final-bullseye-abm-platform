alter table contacts
  add column if not exists phone_enrichment_status text,
  add column if not exists phone_enriched_at       timestamptz,
  add column if not exists phone_source            text,
  add column if not exists lusha_lookup_at         timestamptz,
  add column if not exists lemlist_lookup_at       timestamptz;
create index if not exists contacts_phone_enrichment_status_idx on contacts (phone_enrichment_status);
