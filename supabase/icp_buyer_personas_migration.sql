-- Sprint 5 fase 8 — Buyer Persona configurable
-- Agrega el bloque de buyer personas al ICP. El pre-filtro de contactos
-- (lib/contactsPrompts.ts) lee target_roles / excluded_roles / notes de
-- acá en vez de la lista hardcodeada — así el usuario puede editar qué
-- cargos pasan el filtro desde /configuracion/icp sin tocar código.
--
-- Shape del jsonb:
--   { "target_roles": string[], "excluded_roles": string[], "notes": string }
--
-- Pega esto en el SQL editor de Supabase y ejecuta. Idempotente.

alter table icp_config
  add column if not exists buyer_personas jsonb;
