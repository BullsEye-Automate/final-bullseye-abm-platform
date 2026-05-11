-- Sprint 2 fase B — tracking de empujones a Clay
-- Pega esto en el SQL editor de Supabase y ejecuta una sola vez.

alter table companies
  add column if not exists clay_pushed_at timestamptz,
  add column if not exists clay_push_error text;

create index if not exists companies_clay_pushed_idx
  on companies (clay_pushed_at);
