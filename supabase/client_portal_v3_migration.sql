-- BullsEye · Portal de clientes v3: búsqueda unificada, exclusiones y solicitudes manuales
-- Ejecutar en el SQL editor de Supabase (es idempotente).
-- Requiere haber corrido antes client_portal_migration.sql y client_wishlist_migration.sql.

-- ============================================================
-- 1. Wishlist: empresas solicitadas a mano (no estaban en ninguna base)
-- ============================================================
alter table client_wishlist drop constraint if exists client_wishlist_source_check;
alter table client_wishlist add constraint client_wishlist_source_check
  check (source in ('hubspot', 'lemlist', 'signals', 'manual'));

-- ============================================================
-- 2. Lista de exclusión del cliente (portal)
-- ============================================================
-- kind = 'company': empresa puntual (nombre y/o dominio), cargada a mano o desde Excel
-- kind = 'keyword': palabra clave; excluye toda empresa cuyo nombre la contenga
-- Las empresas (kind company) se copian además a excluded_companies para que
-- la prospección interna de BullsEye también las omita.
create table if not exists client_exclusions (
  id            uuid primary key default uuid_generate_v4(),
  client_id     uuid not null references clients(id) on delete cascade,
  kind          text not null check (kind in ('company', 'keyword')),
  company_name  text,
  domain        text,                 -- normalizado (sin www, minúsculas)
  keyword       text,
  reason        text,                 -- ej. "Ya es cliente", "La trabaja otro proveedor"
  created_by    uuid references client_users(id) on delete set null,
  created_by_email text,
  created_at    timestamptz not null default now(),
  check (
    (kind = 'company' and (company_name is not null or domain is not null))
    or (kind = 'keyword' and keyword is not null)
  )
);

create index if not exists client_exclusions_client_idx on client_exclusions (client_id, created_at desc);
create unique index if not exists client_exclusions_domain_uidx
  on client_exclusions (client_id, domain) where kind = 'company' and domain is not null;
create unique index if not exists client_exclusions_name_uidx
  on client_exclusions (client_id, lower(company_name)) where kind = 'company' and company_name is not null and domain is null;
create unique index if not exists client_exclusions_keyword_uidx
  on client_exclusions (client_id, lower(keyword)) where kind = 'keyword';

alter table client_exclusions enable row level security;

-- ============================================================
-- 3. Traducciones al español de los valores de filtros de Lemlist
-- ============================================================
-- Se generan una vez con IA (industrias, regiones, tipos…) y se reutilizan.
create table if not exists lemlist_value_labels (
  filter_id   text not null,
  value       text not null,
  label_es    text not null,
  created_at  timestamptz not null default now(),
  primary key (filter_id, value)
);

alter table lemlist_value_labels enable row level security;

-- Equivalencia industria Lemlist → valores de industria de HubSpot (para buscar
-- en las dos bases con un solo filtro). Se genera con IA la primera vez.
create table if not exists industry_value_map (
  lemlist_value    text primary key,
  hubspot_values   text[] not null default '{}',
  created_at       timestamptz not null default now()
);

alter table industry_value_map enable row level security;

-- ============================================================
-- 4. Búsqueda sobre el pool de HubSpot (v2)
-- ============================================================
-- Cambios vs v1: p_query busca también en la descripción y se agrega
-- p_exclude_keywords (excluye empresas cuyo nombre contenga alguna palabra).
drop function if exists search_hubspot_pool(jsonb, text, text[], text[], integer, integer);

create or replace function search_hubspot_pool(
  p_filters           jsonb    default '[]'::jsonb,
  p_query             text     default null,
  p_exclude_domains   text[]   default '{}',
  p_exclude_names     text[]   default '{}',
  p_exclude_keywords  text[]   default '{}',
  p_limit             integer  default 24,
  p_offset            integer  default 0
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
    and not exists (
      select 1 from unnest(coalesce(p_exclude_keywords, '{}')) k
      where k <> '' and p.name ilike '%' || k || '%'
    )
    and (
      p_query is null or p_query = ''
      or p.name ilike '%' || p_query || '%'
      or p.domain ilike '%' || p_query || '%'
      or (p.properties ->> 'description') ilike '%' || p_query || '%'
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

revoke execute on function search_hubspot_pool(jsonb, text, text[], text[], text[], integer, integer) from public, anon, authenticated;
grant execute on function search_hubspot_pool(jsonb, text, text[], text[], text[], integer, integer) to service_role;
