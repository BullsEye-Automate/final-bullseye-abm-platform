-- Historial de cambios de estado de reuniones hechos desde la app (Células
-- SDR → Registro de reuniones). Cada cambio se escribe en la planilla API
-- Reuniones (columna "Realizado") y en meetings, y queda registrado aquí.
create table if not exists meeting_status_changes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid,
  sheet_row_key text not null,
  empresa text,
  old_status text,
  new_status text not null,
  changed_by text not null,
  changed_at timestamptz not null default now()
);
create index if not exists meeting_status_changes_key_idx on meeting_status_changes (sheet_row_key, changed_at desc);
alter table meeting_status_changes enable row level security;
