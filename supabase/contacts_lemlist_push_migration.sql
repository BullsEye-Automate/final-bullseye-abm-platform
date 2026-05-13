-- Sprint 3 fase 2: bypass Clay para approvals de manual_review.
-- La app empuja contactos aprobados directamente a Lemlist via API.
-- Estos campos rastrean ese push para mostrar estado en la UI y para evitar
-- duplicar pushes si el usuario aprueba dos veces.

alter table contacts
  add column if not exists lemlist_pushed_at timestamptz,
  add column if not exists lemlist_push_error text;

create index if not exists contacts_lemlist_pushed_at_idx
  on contacts (lemlist_pushed_at);
