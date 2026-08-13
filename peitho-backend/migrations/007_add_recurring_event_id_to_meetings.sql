-- Peitho — distinguir reuniones que son ocurrencias de una serie recurrente
-- de Google Calendar (ej. una reunión semanal fija), que casi nunca son con
-- un prospecto real y ensucian las listas del frontend (ver CLAUDE.md).
-- Google devuelve `recurringEventId` en cada ocurrencia expandida de una
-- serie (singleEvents:true) — null si el evento no es recurrente.

alter table meetings add column if not exists recurring_event_id text;

create index if not exists idx_meetings_recurring_event_id on meetings (recurring_event_id);
