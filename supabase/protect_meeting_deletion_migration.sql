-- Protect meetings with feedback from being deleted
-- Add trigger to prevent deletion of meetings that have feedback

create or replace function prevent_meeting_deletion_with_feedback()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Check if this meeting has any feedback
  if exists(
    select 1 from meeting_feedback where meeting_id = old.id limit 1
  ) then
    raise exception 'Cannot delete meeting that has feedback records. Delete feedback first.';
  end if;
  return old;
end;
$$;

-- Drop trigger if it exists
drop trigger if exists prevent_delete_meeting_with_feedback on meetings;

-- Create trigger
create trigger prevent_delete_meeting_with_feedback
before delete on meetings
for each row
execute function prevent_meeting_deletion_with_feedback();

-- Add audit log table for tracking deletions
create table if not exists deletion_audit_log (
  id uuid primary key default uuid_generate_v4(),
  table_name text not null,
  record_id uuid not null,
  client_id uuid,
  deleted_at timestamptz default now(),
  deleted_by text,
  context text
);

grant all on deletion_audit_log to authenticated;
