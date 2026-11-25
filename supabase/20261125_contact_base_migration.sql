-- Base de contactos central (Centro de prospección → Base de contactos, nov-2026).
-- Una fila por persona con los celulares y correos que ya tenemos en los
-- HubSpot de BullsEye y de los clientes, para no volver a pagar créditos de
-- Lemlist por datos que ya existen (decisión de la reunión «Lemlist 2027»,
-- 25-nov-2026). Solo lectura desde HubSpot; la llena el cron
-- /api/cron/base-contactos. Solo la ve el equipo (no el portal del cliente).

create table if not exists contact_base (
  person_key     text primary key,                 -- li:<slug de LinkedIn> | em:<correo> | hs:<fuente>:<id>
  name           text,
  title          text,
  company        text,
  company_domain text,                             -- dominio del correo corporativo
  country        text,                             -- país inferido del celular o del contacto
  linkedin       text,
  email          text,
  emails         text[] not null default '{}',
  mobiles        text[] not null default '{}',     -- celulares confirmados por formato (CL, CO, PE, AR)
  mobiles_maybe  text[] not null default '{}',     -- posibles celulares (México: el formato no lo distingue)
  clients        text[] not null default '{}',     -- valores de «Cliente BullsEye» del contacto
  sources        jsonb not null default '[]'::jsonb, -- [{ s: fuente, id, c: creado, m: tiene celular, lp: tiene teléfono Lemlist }]
  synced_at      timestamptz not null default now()
);

create index if not exists contact_base_linkedin_idx on contact_base (linkedin);
create index if not exists contact_base_email_idx on contact_base (email);
create index if not exists contact_base_domain_idx on contact_base (company_domain);

alter table contact_base enable row level security;
