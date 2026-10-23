-- BullsEye · Prospección v2: propuestas de BullsEye al cliente + contactos a HubSpot
-- Ejecutar en el SQL editor de Supabase (es idempotente).
-- Requiere haber corrido antes client_wishlist_migration.sql y wishlist_contacts_migration.sql.

-- ============================================================
-- 1. Empresas propuestas por BullsEye (esperan aprobación del cliente)
-- ============================================================
-- origin = 'client'   el cliente la pidió desde el portal
-- origin = 'bullseye' la propuso un prospector desde Empresas; queda
--                     'proposed' hasta que el cliente la apruebe (→ 'new',
--                     se envía a su Lemlist) o la rechace ('rejected_by_client')
alter table client_wishlist add column if not exists origin text not null default 'client';
alter table client_wishlist drop constraint if exists client_wishlist_origin_check;
alter table client_wishlist add constraint client_wishlist_origin_check check (origin in ('client', 'bullseye'));

alter table client_wishlist drop constraint if exists client_wishlist_status_check;
alter table client_wishlist add constraint client_wishlist_status_check
  check (status in ('proposed', 'rejected_by_client', 'new', 'in_lemlist', 'in_progress', 'contacts_found', 'discarded'));

alter table client_wishlist add column if not exists client_decision_at timestamptz;
alter table client_wishlist add column if not exists client_decision_by_email text;
alter table client_wishlist add column if not exists client_reject_reason text;
alter table client_wishlist add column if not exists hubspot_company_id text;

-- ============================================================
-- 2. Contactos aprobados → HubSpot de BullsEye
-- ============================================================
alter table wishlist_contacts add column if not exists hubspot_contact_id text;
alter table wishlist_contacts add column if not exists hubspot_error text;
