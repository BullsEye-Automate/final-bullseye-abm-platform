-- Sprint 6 fase 1 — Outreach tracking: actividades de Lemlist
-- Guarda los eventos de la cadencia multicanal de Lemlist (visita LinkedIn,
-- invitación, conexión, email enviado/abierto/respondido, bounce, etc.) para
-- que el módulo /campanas muestre en qué paso está cada lead sin entrar a
-- Lemlist. Se llena con POST /api/lemlist/sync-activities.
--
-- Pega esto en el SQL editor de Supabase y ejecuta. Idempotente.

create table if not exists lemlist_activities (
  id                   uuid primary key default uuid_generate_v4(),

  -- Dedup: _id de Lemlist si lo trae; si no, una clave sintética
  -- determinística (email:type:date) — ver lib/lemlistActivities.ts.
  lemlist_activity_id  text not null unique,

  -- Join a nuestra DB (resuelto por email en el sync; puede quedar null si
  -- el lead de Lemlist no matchea ningún contacto nuestro).
  contact_id           uuid references contacts(id) on delete set null,

  lead_email           text,
  lead_id              text,                 -- id del lead en Lemlist
  campaign_id          text,

  channel              text,                 -- 'email' | 'linkedin' | 'call' | 'other'
  type                 text,                 -- tipo crudo de Lemlist (emailsSent, linkedinInvite, ...)
  activity_at          timestamptz,

  raw                  jsonb,
  created_at           timestamptz not null default now()
);

create index if not exists idx_lemlist_activities_contact on lemlist_activities(contact_id);
create index if not exists idx_lemlist_activities_email   on lemlist_activities(lead_email);
create index if not exists idx_lemlist_activities_at      on lemlist_activities(activity_at);
