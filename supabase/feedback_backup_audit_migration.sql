-- Tabla de auditoria de backups automáticos de feedbacks
-- Guarda un snapshot periódico de todos los feedbacks para recuperación ante desastres

create table if not exists feedback_backup_snapshots (
  id uuid primary key default uuid_generate_v4(),
  snapshot_date timestamptz default now(),
  total_feedbacks int not null,
  backup_data jsonb not null,
  created_at timestamptz default now()
);

-- Índice para buscar snapshots por fecha
create index if not exists feedback_backup_snapshots_date_idx
  on feedback_backup_snapshots (snapshot_date desc);

-- Tabla de auditoría de cambios en meeting_feedback
create table if not exists feedback_audit_log (
  id uuid primary key default uuid_generate_v4(),
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  meeting_id uuid not null,
  feedback_id uuid,
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz default now(),
  changed_by text
);

create index if not exists feedback_audit_log_meeting_idx
  on feedback_audit_log (meeting_id);
create index if not exists feedback_audit_log_date_idx
  on feedback_audit_log (changed_at desc);

-- Trigger para auditar cambios en meeting_feedback
create or replace function audit_feedback_changes()
returns trigger
language plpgsql
security definer
as $$
begin
  if tg_op = 'INSERT' then
    insert into feedback_audit_log (action, meeting_id, feedback_id, new_data)
    values ('INSERT', new.meeting_id, new.id, row_to_json(new));
  elsif tg_op = 'UPDATE' then
    insert into feedback_audit_log (action, meeting_id, feedback_id, old_data, new_data)
    values ('UPDATE', new.meeting_id, new.id, row_to_json(old), row_to_json(new));
  elsif tg_op = 'DELETE' then
    insert into feedback_audit_log (action, meeting_id, feedback_id, old_data)
    values ('DELETE', old.meeting_id, old.id, row_to_json(old));
  end if;
  return null;
end;
$$;

-- Crear trigger
drop trigger if exists feedback_audit_trigger on meeting_feedback;
create trigger feedback_audit_trigger
after insert or update or delete on meeting_feedback
for each row
execute function audit_feedback_changes();

-- Permitir lectura de audit logs
grant select on feedback_audit_log to authenticated;
grant select on feedback_backup_snapshots to authenticated;
