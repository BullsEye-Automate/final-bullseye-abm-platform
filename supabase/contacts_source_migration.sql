-- Sprint 5 — Tracking de origen de contacto.
--
-- Disparador: el dashboard necesita distinguir contactos que vinieron de Clay
-- (Find People webhook) vs los que el SDR enriqueció a mano vía Sales
-- Navigator (Campaña puente → import) vs scrapeados de la web vs importados
-- manualmente desde /contactos. Sin esto, las métricas "trabajadas por Sales
-- Nav" tienen que adivinarse con heurísticas frágiles.
--
-- Valores posibles para source:
--   'clay'           : webhook /api/clay/raw-contacts (Find People de Clay).
--   'sales_navigator': /api/sales-navigator/[id]/import (Campaña puente).
--   'web_scrape'     : /api/companies/[id]/scrape-contacts (Perplexity + Claude
--                      sobre el sitio web de la empresa).
--   'manual'         : /api/contacts/import (paste JSON manual).
--   null             : NO debería quedar ninguno post-backfill (ver más abajo).
--
-- Idempotente con IF NOT EXISTS.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source text;

CREATE INDEX IF NOT EXISTS contacts_source_idx ON contacts(source);

-- Backfill heurístico de contactos pre-migración:
--
-- Hasta ahora la única señal indirecta de origen era clay_no_contacts_at en
-- la empresa. Si Clay marcó "no contacts" para una empresa pero ahora hay
-- contactos en esa empresa, esos contactos casi seguro vinieron de Sales
-- Nav (el SDR los importó después).
--
-- El resto de contactos legacy se asume Clay (es el flujo dominante en
-- producción a la fecha de la migración). Algunos casos de minoría
-- (web_scrape o manual import) van a quedar mal categorizados como Clay,
-- pero es un trade-off aceptable — el dashboard arranca con datos útiles.

UPDATE contacts c
SET source = 'sales_navigator'
WHERE source IS NULL
  AND company_id IN (
    SELECT id FROM companies WHERE clay_no_contacts_at IS NOT NULL
  );

UPDATE contacts SET source = 'clay' WHERE source IS NULL;
