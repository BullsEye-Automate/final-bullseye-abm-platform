-- BullsEye · Portal de clientes (fase 2: wishlist de empresas)
-- Ejecutar en el SQL editor de Supabase (es idempotente).
-- Requiere haber corrido antes client_portal_migration.sql.

-- ============================================================
-- 1. Pool de empresas de HubSpot (base de BullsEye, +20.000)
-- ============================================================
-- Copia local de las empresas de HubSpot para poder filtrar y puntuar sin
-- golpear la API de HubSpot en cada búsqueda. Se sincroniza desde
-- /solicitudes-clientes → "Base HubSpot". Solo guarda propiedades
-- firmográficas (ver lib/hubspotPool.ts), nunca datos de prospección.

create table if not exists hubspot_company_pool (
  hs_id       text primary key,
  name        text not null,
  domain      text,                         -- normalizado (sin www, minúsculas)
  properties  jsonb not null default '{}'::jsonb, -- solo propiedades rellenadas
  synced_at   timestamptz not null default now()
);

create index if not exists hubspot_company_pool_domain_idx on hubspot_company_pool (domain);
create index if not exists hubspot_company_pool_props_idx on hubspot_company_pool using gin (properties jsonb_path_ops);
create index if not exists hubspot_company_pool_name_idx on hubspot_company_pool (lower(name));

alter table hubspot_company_pool enable row level security;

-- Propiedades filtrables: definición (label, tipo, opciones) y cuántas
-- empresas las tienen rellenadas. El portal arma los filtros con esto.
create table if not exists hubspot_pool_properties (
  name         text primary key,
  label        text not null,
  type         text not null,               -- string | number | enumeration | bool | date …
  field_type   text,
  options      jsonb not null default '[]'::jsonb, -- [{value, label}] para enumeraciones
  filled_count integer not null default 0,
  updated_at   timestamptz not null default now()
);

alter table hubspot_pool_properties enable row level security;

-- Estado de la sincronización (una sola fila, id = 'hubspot')
create table if not exists hubspot_pool_sync_state (
  id            text primary key,
  status        text not null default 'idle' check (status in ('idle', 'running', 'done', 'error')),
  after_cursor  text,
  synced_count  integer not null default 0,
  started_at    timestamptz,
  finished_at   timestamptz,
  last_error    text,
  updated_at    timestamptz not null default now()
);

alter table hubspot_pool_sync_state enable row level security;

-- ============================================================
-- 2. Wishlist por cliente
-- ============================================================
-- Cada empresa que un cliente agrega desde el portal. Una empresa agregada
-- no vuelve a aparecer en sus búsquedas (dedupe por dominio y por nombre).

create table if not exists client_wishlist (
  id                uuid primary key default uuid_generate_v4(),
  client_id         uuid not null references clients(id) on delete cascade,
  company_name      text not null,
  domain            text,                   -- normalizado
  linkedin_url      text,
  source            text not null check (source in ('hubspot', 'lemlist', 'signals')),
  source_ref        text,                   -- hs_id o id de Lemlist
  mode              text not null default 'manual' check (mode in ('manual', 'ai')),
  fit_score         integer,                -- 0–100
  fit_reason        text,
  snapshot          jsonb not null default '{}'::jsonb, -- datos mostrados al cliente al agregarla
  status            text not null default 'new'
                      check (status in ('new', 'in_lemlist', 'in_progress', 'contacts_found', 'discarded')),
  lemlist_status    text,                   -- resultado del envío a Lemlist (ok / error / pendiente)
  lemlist_error     text,
  internal_note     text,
  requested_by      uuid references client_users(id) on delete set null,
  requested_by_email text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists client_wishlist_client_idx on client_wishlist (client_id, created_at desc);
create index if not exists client_wishlist_status_idx on client_wishlist (status, created_at desc);
create unique index if not exists client_wishlist_client_domain_uidx
  on client_wishlist (client_id, domain) where domain is not null;
create unique index if not exists client_wishlist_client_name_uidx
  on client_wishlist (client_id, lower(company_name));

alter table client_wishlist enable row level security;

-- ============================================================
-- 3. Caché de puntajes de fit (IA)
-- ============================================================
-- Evita volver a pagar el scoring de la misma empresa para el mismo ICP.
-- icp_hash cambia cuando cambia el ICP vigente → se recalcula.

create table if not exists company_fit_scores (
  client_id   uuid not null references clients(id) on delete cascade,
  source      text not null,
  source_key  text not null,               -- hs_id, id de Lemlist o dominio
  icp_hash    text not null,
  fit_score   integer not null,
  fit_reason  text not null,
  created_at  timestamptz not null default now(),
  primary key (client_id, source, source_key, icp_hash)
);

alter table company_fit_scores enable row level security;

-- ============================================================
-- 4. Búsqueda sobre el pool de HubSpot
-- ============================================================
-- p_filters: [{ "property": "industry", "op": "in", "values": ["X","Y"] },
--             { "property": "numberofemployees", "op": "range", "min": 50, "max": 500 },
--             { "property": "web_technologies", "op": "in", "values": ["hubspot"] },
--             { "property": "description", "op": "contains", "value": "logística" },
--             { "property": "country", "op": "exists" }]
-- SQL estático (sin EXECUTE dinámico): los nombres de propiedad y valores se
-- usan solo como datos, así que no hay riesgo de inyección.
create or replace function search_hubspot_pool(
  p_filters          jsonb    default '[]'::jsonb,
  p_query            text     default null,
  p_exclude_domains  text[]   default '{}',
  p_exclude_names    text[]   default '{}',
  p_limit            integer  default 24,
  p_offset           integer  default 0
)
returns table (hs_id text, name text, domain text, properties jsonb, total_count bigint)
language sql
stable
set search_path = public
as $$
  select p.hs_id, p.name, p.domain, p.properties, count(*) over () as total_count
  from hubspot_company_pool p
  where (p.domain is null or not (p.domain = any (p_exclude_domains)))
    and not (lower(p.name) = any (p_exclude_names))
    and (
      p_query is null or p_query = ''
      or p.name ilike '%' || p_query || '%'
      or p.domain ilike '%' || p_query || '%'
    )
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb)) f
      where not coalesce(
        case f->>'op'
          when 'in' then
            case jsonb_typeof(p.properties -> (f->>'property'))
              when 'array' then exists (
                select 1
                from jsonb_array_elements_text(p.properties -> (f->>'property')) pv
                join jsonb_array_elements_text(f->'values') fv on lower(pv) = lower(fv)
              )
              else exists (
                select 1
                from jsonb_array_elements_text(f->'values') fv
                where lower(p.properties ->> (f->>'property')) = lower(fv)
              )
            end
          when 'range' then
            -- cast protegido: un valor no numérico cuenta como "no cumple"
            (case when (p.properties ->> (f->>'property')) ~ '^-?[0-9]+(\.[0-9]+)?$'
                  then (p.properties ->> (f->>'property'))::numeric end)
              between coalesce((f->>'min')::numeric, '-infinity'::numeric)
                  and coalesce((f->>'max')::numeric, 'infinity'::numeric)
          when 'contains' then
            (p.properties ->> (f->>'property')) ilike '%' || (f->>'value') || '%'
          when 'exists' then
            p.properties ? (f->>'property')
          else true
        end,
        false
      )
    )
  order by p.name
  limit greatest(1, least(p_limit, 100))
  offset greatest(0, p_offset);
$$;

-- Solo el service role (las APIs del servidor) puede ejecutarla
revoke execute on function search_hubspot_pool(jsonb, text, text[], text[], integer, integer) from public, anon, authenticated;
grant execute on function search_hubspot_pool(jsonb, text, text[], text[], integer, integer) to service_role;
