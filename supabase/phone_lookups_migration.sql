create table if not exists phone_lookups (
  id            uuid primary key default uuid_generate_v4(),
  linkedin_url  text not null,
  phone         text,
  provider      text,
  source        text not null,
  client_id     uuid references clients(id),
  created_at    timestamptz not null default now()
);

create index if not exists phone_lookups_linkedin_idx on phone_lookups (linkedin_url, created_at desc);
