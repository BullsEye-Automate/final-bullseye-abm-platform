-- Sprint 4 fase 2 — enrichment de teléfono.
-- Lemlist primero (más barato), Lusha fallback (caro pero confiable).
-- El status lo escribe el orquestador en lib/phoneEnrichment.ts.
--
-- Estados de phone_enrichment_status:
--   null            → todavía no se intentó
--   'lemlist_pending' → push a Lemlist hecho, esperando a que enrich corra
--   'done_lemlist'  → phone encontrado en Lemlist
--   'done_lusha'    → phone encontrado en Lusha (Lemlist falló)
--   'not_found'     → ni Lemlist ni Lusha encontraron phone
--   'requested'     → SDR pidió enrichment manual desde HubSpot

alter table contacts
  add column if not exists phone_enrichment_status text,
  add column if not exists phone_enriched_at timestamptz,
  add column if not exists phone_source text,
  add column if not exists lusha_lookup_at timestamptz,
  add column if not exists lemlist_lookup_at timestamptz;

create index if not exists contacts_phone_enrichment_status_idx
  on contacts (phone_enrichment_status);
