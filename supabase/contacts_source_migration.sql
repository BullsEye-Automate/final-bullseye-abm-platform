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
--   null             : contactos creados antes de esta migración (legado).
--
-- Idempotente con IF NOT EXISTS.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source text;

CREATE INDEX IF NOT EXISTS contacts_source_idx ON contacts(source);
