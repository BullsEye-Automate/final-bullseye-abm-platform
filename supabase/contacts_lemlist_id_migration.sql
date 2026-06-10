alter table contacts add column if not exists lemlist_contact_id text;
alter table contacts add column if not exists lemlist_lead_id    text;

create unique index if not exists contacts_lemlist_contact_id_unique
  on contacts (lemlist_contact_id) where lemlist_contact_id is not null;
