-- CRITICAL: Replace CASCADE DELETE with RESTRICT to prevent accidental data loss
-- This migration modifies foreign key constraints to prevent cascading deletes
--
-- IMPORTANT: Run this AFTER protect_meeting_deletion_migration.sql
-- The trigger on meetings will prevent deletion of meetings with feedback,
-- which means these foreign key restrictions will effectively prevent
-- client deletion if any meetings have feedback.

-- First, we need to modify the foreign key on meetings.client_id
-- Drop and recreate the constraint
alter table meetings
  drop constraint if exists meetings_client_id_fkey;

alter table meetings
  add constraint meetings_client_id_fkey
  foreign key (client_id) references clients(id) on delete restrict;

-- Modify the foreign key on meeting_feedback.meeting_id
alter table meeting_feedback
  drop constraint if exists meeting_feedback_meeting_id_fkey;

alter table meeting_feedback
  add constraint meeting_feedback_meeting_id_fkey
  foreign key (meeting_id) references meetings(id) on delete restrict;

-- Note: The trigger prevent_meeting_deletion_with_feedback will catch
-- attempts to delete meetings with feedback before this constraint is checked
