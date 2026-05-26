-- BullsEye · Sales Navigator y Clay no-contacts
alter table companies
  add column if not exists clay_no_contacts_at  timestamptz,
  add column if not exists sales_nav_status      text check (sales_nav_status in ('no_fit')),
  add column if not exists sales_nav_checked_at  timestamptz;

create index if not exists companies_clay_no_contacts_idx on companies (clay_no_contacts_at);
create index if not exists companies_sales_nav_idx        on companies (sales_nav_status);
