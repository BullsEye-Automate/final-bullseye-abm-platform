alter table contacts
  add column if not exists lemlist_pushed_at  timestamptz,
  add column if not exists lemlist_push_error text;
create index if not exists contacts_lemlist_pushed_at_idx on contacts (lemlist_pushed_at);
