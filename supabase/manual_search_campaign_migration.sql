-- BullsEye · Campaña puente dedicada para Búsqueda manual
--
-- Antes, /busqueda-manual reusaba lemlist_staging_campaign_id, la misma
-- campaña puente que usa /api/lemlist/lookup-phone para enriquecer teléfonos
-- 1 a 1. Al compartir la campaña, los leads de ambos procesos se mezclaban
-- (contactos sin empresa/fecha reconocible al importar). Esta columna permite
-- configurar una campaña puente separada, exclusiva para búsqueda manual.
-- Si queda vacía, /busqueda-manual sigue usando lemlist_staging_campaign_id
-- como fallback (compatibilidad con clientes que no la configuraron todavía).

alter table client_configs
  add column if not exists lemlist_manual_search_campaign_id text;
