-- Sprint 2 fase B — tracking de empujones de contactos a Clay
-- Pega esto en el SQL editor de Supabase y ejecuta una sola vez.

alter table contacts
  add column if not exists clay_pushed_at timestamptz,
  add column if not exists clay_push_error text;

create index if not exists contacts_clay_pushed_idx
  on contacts (clay_pushed_at);
