-- Sprint 4: HubSpot writer. Cuando un contacto se aprueba desde manual_review
-- o una empresa se aprueba en /empresas, la app empuja a HubSpot creando el
-- registro con todos los wecad_* custom fields. Estos campos rastrean ese push.
--
-- contacts.hubspot_contact_id ya existe en contacts_migration.sql; solo agregamos
-- los timestamps + el error persistido.
-- companies no tenía nada de HubSpot — agregamos las 3 columnas.

alter table contacts
  add column if not exists hubspot_synced_at timestamptz,
  add column if not exists hubspot_sync_error text;

create index if not exists contacts_hubspot_synced_at_idx
  on contacts (hubspot_synced_at);

alter table companies
  add column if not exists hubspot_company_id text,
  add column if not exists hubspot_synced_at timestamptz,
  add column if not exists hubspot_sync_error text;

create index if not exists companies_hubspot_synced_at_idx
  on companies (hubspot_synced_at);
