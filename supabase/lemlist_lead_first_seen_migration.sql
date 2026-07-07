-- BullsEye · Fecha de alta confiable para leads de la Campaña puente
--
-- Lemlist no expone una fecha de "cuándo se agregó este lead a ESTA
-- campaña" — el list endpoint solo trae {_id, state, contactId}, y el
-- contacto solo tiene createdAt (global al workspace: si el contacto ya
-- existía de antes por otro proceso —ej. lookup-phone— esa fecha puede ser
-- vieja aunque recién se agregó a la Campaña puente hoy). Por eso el filtro
-- de fecha en /busqueda-manual fallaba para leads reutilizados.
--
-- Esta tabla registra la primera vez que la app VE cada lead en cada
-- campaña — es nuestra propia fuente de verdad para "added_at", en vez de
-- depender de los campos (poco confiables) de Lemlist.

create table if not exists lemlist_lead_first_seen (
  campaign_id     text not null,
  lemlist_lead_id text not null,
  first_seen_at   timestamptz not null default now(),
  primary key (campaign_id, lemlist_lead_id)
);
