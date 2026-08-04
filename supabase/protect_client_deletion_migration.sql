-- Protect client deletion: prevent deletion if meetings with feedback exist
create or replace function count_feedback_for_client(client_id uuid)
returns table(count bigint)
language sql
security definer
as $$
  select count(*)::bigint
  from meeting_feedback mf
  join meetings m on mf.meeting_id = m.id
  where m.client_id = count_feedback_for_client.client_id;
$$;

-- Grant execute permission to authenticated users
grant execute on function count_feedback_for_client(uuid) to authenticated;
