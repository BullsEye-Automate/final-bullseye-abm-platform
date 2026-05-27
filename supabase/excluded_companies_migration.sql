create table if not exists excluded_companies (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid references clients(id) on delete cascade not null,
  company_name text not null,
  company_website text,
  added_at   timestamptz default now()
);

create unique index if not exists excluded_companies_client_name_idx
  on excluded_companies (client_id, lower(company_name));
