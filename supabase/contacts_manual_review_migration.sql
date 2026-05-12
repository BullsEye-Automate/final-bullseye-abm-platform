-- Sprint 3 — registro del veredicto humano sobre la cola de revisión manual.
-- Pega esto en el SQL editor de Supabase y ejecuta una sola vez.

alter table contacts
  add column if not exists human_decision        text check (human_decision in ('approved','rejected')),
  add column if not exists human_decision_at     timestamptz,
  add column if not exists human_decision_reason text,
  add column if not exists human_decision_by     text;

create index if not exists contacts_human_decision_idx
  on contacts (human_decision);
