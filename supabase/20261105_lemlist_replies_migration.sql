-- Respuestas de Lemlist → SDR asignado (lib/respuestasLemlist/).
-- Una fila por respuesta (actividad de Lemlist), con su clasificación y lo
-- que se hizo con ella. activity_id único = no se procesa dos veces.
create table if not exists lemlist_replies (
  id uuid primary key default uuid_generate_v4(),
  activity_id text not null unique,
  client_id uuid references clients(id) on delete cascade,
  client_name text,
  campaign_id text,
  campaign_name text,
  channel text,                    -- email | linkedin
  lead_email text,
  lead_name text,
  company_name text,
  reply_text text,
  replied_at timestamptz,
  category text,                   -- interesado | referido | tibio | no_interesado | fuera_oficina | baja | sin_texto
  confidence numeric,
  summary text,
  sdr_value text,                  -- valor de la propiedad SDR en HubSpot (ej. "Nico")
  sdr_name text,
  sdr_email text,
  kam_email text,
  hs_contact_id text,
  hs_company_id text,
  action text,                     -- asignada | alerta_kam | revision_kam | baja | sin_accion | error
  action_detail text,
  mode text,                       -- sombra | activo
  hubspot_updated boolean default false,
  lemlist_paused boolean default false,
  notified_to text[],
  error text,
  created_at timestamptz default now()
);

create index if not exists idx_lemlist_replies_client on lemlist_replies(client_id, created_at desc);
create index if not exists idx_lemlist_replies_created on lemlist_replies(created_at desc);

alter table lemlist_replies enable row level security;
