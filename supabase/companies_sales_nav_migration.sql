-- Sprint 6 fase 4 — Módulo Sales Navigator
--
-- Las empresas que Clay no pudo prospectar (Find People = 0 contactos) ya
-- quedan marcadas con companies.clay_no_contacts_at (loop de feedback del
-- PR #91). El módulo /sales-navigator las junta para que el usuario las
-- busque a mano en LinkedIn Sales Navigator.
--
-- sales_nav_status:
--   null      → "Por revisar" (Clay no encontró contactos, falta revisar
--               en Sales Navigator).
--   'no_fit'  → revisada en Sales Navigator, sin contactos fit. Sale de la
--               cola "Por revisar" y pasa a "Sin contactos fit".
-- Cuando se importan contactos, intakeContactsForCompany limpia
-- clay_no_contacts_at + sales_nav_status → la empresa sale del módulo.
--
-- Pega esto en el SQL editor de Supabase y ejecuta. Idempotente.

alter table companies
  add column if not exists sales_nav_status     text,
  add column if not exists sales_nav_checked_at timestamptz;
