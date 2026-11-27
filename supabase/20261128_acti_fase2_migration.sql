-- ACTI · Red de Negocios — Fase 2 (Buscar cuentas y Mis solicitudes)
-- Solo tablas y funciones NUEVAS (prefijo acti_). No modifica tablas ni
-- funciones existentes. Idempotente. Requiere la migración de la Fase 1.

-- ============================================================
-- 1. Perfiles disponibles por empresa (desde la Base de contactos)
-- ============================================================
-- Resumen por dominio de empresa: cuántas personas tenemos, cuántas con
-- celular y qué tipos de cargo (área / nivel). SIN nombres ni datos
-- personales: es lo que ve el socio ("perfiles disponibles") y lo que usa
-- el motor para priorizar empresas con contactos (menor costo de gestión).
-- La llena el cron /api/cron/acti-perfiles (lib/acti/people.ts).
create table if not exists acti_company_people (
  domain      text primary key,
  contacts    integer not null default 0,
  mobiles     integer not null default 0,     -- personas con celular confirmado
  areas       text[] not null default '{}',
  levels      text[] not null default '{}',
  titles      text[] not null default '{}',   -- cargos normalizados (máx. 40), para el filtro por cargo
  updated_at  timestamptz not null default now()
);
create index if not exists acti_company_people_mobiles_idx on acti_company_people (mobiles desc);
alter table acti_company_people enable row level security;

-- ============================================================
-- 2. Empresas guardadas por el socio
-- ============================================================
create table if not exists acti_saved_companies (
  id            uuid primary key default uuid_generate_v4(),
  client_id     uuid not null references clients(id) on delete cascade,
  hs_id         text not null,                 -- empresa del pool (hubspot_company_pool)
  company_name  text not null,
  domain        text,
  saved_by      text,
  created_at    timestamptz not null default now(),
  unique (client_id, hs_id)
);
create index if not exists acti_saved_client_idx on acti_saved_companies (client_id, created_at desc);
alter table acti_saved_companies enable row level security;

-- ============================================================
-- 3. Solicitudes de reunión del socio
-- ============================================================
-- Cada "Quiero reunirme con ellos". Queda en cola ACTI y se libera al flujo
-- real de prospección (client_wishlist) por prioridad de plan; desde ahí el
-- avance se lee del flujo de siempre (no se guarda un estado paralelo).
create table if not exists acti_requests (
  id             uuid primary key default uuid_generate_v4(),
  client_id      uuid not null references clients(id) on delete cascade,
  hs_id          text,                         -- empresa del pool, si vino de ahí
  company_name   text not null,
  domain         text,
  month          text not null,                -- 'YYYY-MM' (hora de Chile) en que se pidió
  personas       jsonb not null default '{}'::jsonb, -- { areas: [], levels: [], titles: "" } tipos de cargo, nunca personas
  comment        text,
  origin         text not null default 'busqueda' check (origin in ('busqueda', 'recomendada', 'guardada', 'manual', 'completada_ia')),
  fit_score      integer,
  priority       integer not null default 0,   -- prioridad del plan al pedirla
  status         text not null default 'en_cola' check (status in ('en_cola', 'liberada', 'cancelada')),
  wishlist_id    uuid references client_wishlist(id) on delete set null,
  released_at    timestamptz,
  release_error  text,
  requested_by   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists acti_requests_client_domain_uidx on acti_requests (client_id, domain) where domain is not null and status <> 'cancelada';
create index if not exists acti_requests_client_idx on acti_requests (client_id, created_at desc);
create index if not exists acti_requests_queue_idx on acti_requests (status, priority desc, created_at);
create index if not exists acti_requests_demand_idx on acti_requests (domain, month);
alter table acti_requests enable row level security;

drop trigger if exists acti_requests_set_updated_at on acti_requests;
create trigger acti_requests_set_updated_at
  before update on acti_requests
  for each row execute function set_updated_at();

-- ============================================================
-- 4. Búsqueda en la base de empresas con conteos por opción
-- ============================================================
create or replace function acti_num(t text) returns numeric
language sql immutable as $$
  select case when t ~ '^-?[0-9]+(\.[0-9]+)?$' then t::numeric end
$$;

create or replace function acti_size_bucket(n numeric) returns text
language sql immutable as $$
  select case
    when n is null then null
    when n <= 10 then '1–10' when n <= 50 then '11–50' when n <= 200 then '51–200'
    when n <= 500 then '201–500' when n <= 1000 then '501–1.000' when n <= 5000 then '1.001–5.000'
    else '5.000+' end
$$;

create or replace function acti_revenue_bucket(n numeric) returns text
language sql immutable as $$
  select case
    when n is null then null
    when n < 1000000 then 'Menos de USD 1M' when n < 10000000 then 'USD 1M–10M'
    when n < 50000000 then 'USD 10M–50M' when n < 250000000 then 'USD 50M–250M'
    else 'Más de USD 250M' end
$$;

-- Tecnologías: el pool puede traerlas como arreglo o como texto "a;b;c"
create or replace function acti_techs(props jsonb) returns text[]
language sql immutable as $$
  select case jsonb_typeof(props -> 'web_technologies')
    when 'array' then array(select lower(trim(x)) from jsonb_array_elements_text(props -> 'web_technologies') x)
    when 'string' then array(select lower(trim(x)) from regexp_split_to_table(props ->> 'web_technologies', '\s*;\s*') x where trim(x) <> '')
    else '{}'::text[] end
$$;

-- Igual, pero con las mayúsculas originales (para mostrar en los conteos)
create or replace function acti_techs_raw(props jsonb) returns text[]
language sql immutable as $$
  select case jsonb_typeof(props -> 'web_technologies')
    when 'array' then array(select trim(x) from jsonb_array_elements_text(props -> 'web_technologies') x)
    when 'string' then array(select trim(x) from regexp_split_to_table(props ->> 'web_technologies', '\s*;\s*') x where trim(x) <> '')
    else '{}'::text[] end
$$;

create or replace function acti_lower_list(f jsonb, k text) returns text[]
language sql immutable as $$
  select coalesce(array(select lower(x) from jsonb_array_elements_text(coalesce(f -> k, '[]'::jsonb)) x), '{}'::text[])
$$;

-- ¿La empresa cumple los filtros? `skip` = faceta que se ignora (para que los
-- conteos de una faceta muestren cuántas habría al elegir otra opción).
create or replace function acti_pool_match(
  props jsonb, p_name text, p_domain text, pe_mobiles integer, pe_areas text[], pe_levels text[], pe_titles text[],
  f jsonb, skip text
) returns boolean
language sql immutable as $$
  select
    (coalesce(f ->> 'q', '') = '' or p_name ilike '%' || (f ->> 'q') || '%' or coalesce(p_domain, '') ilike '%' || (f ->> 'q') || '%')
    and (skip = 'industry' or cardinality(acti_lower_list(f, 'industry')) = 0 or lower(props ->> 'industry') = any (acti_lower_list(f, 'industry')))
    and (skip = 'country'  or cardinality(acti_lower_list(f, 'country'))  = 0 or lower(props ->> 'pais_g')   = any (acti_lower_list(f, 'country')))
    and (skip = 'city'     or cardinality(acti_lower_list(f, 'city'))     = 0 or lower(props ->> 'city')     = any (acti_lower_list(f, 'city')))
    and (skip = 'size'     or cardinality(acti_lower_list(f, 'size'))     = 0 or lower(acti_size_bucket(acti_num(props ->> 'numberofemployees'))) = any (acti_lower_list(f, 'size')))
    and (skip = 'revenue'  or cardinality(acti_lower_list(f, 'revenue'))  = 0 or lower(acti_revenue_bucket(acti_num(props ->> 'annualrevenue'))) = any (acti_lower_list(f, 'revenue')))
    and (skip = 'tech'     or cardinality(acti_lower_list(f, 'tech'))     = 0 or acti_techs(props) && acti_lower_list(f, 'tech'))
    and (skip = 'area'     or cardinality(acti_lower_list(f, 'area'))     = 0 or array(select lower(x) from unnest(coalesce(pe_areas, '{}')) x)  && acti_lower_list(f, 'area'))
    and (skip = 'level'    or cardinality(acti_lower_list(f, 'level'))    = 0 or array(select lower(x) from unnest(coalesce(pe_levels, '{}')) x) && acti_lower_list(f, 'level'))
    and (skip = 'signal'   or coalesce((f ->> 'mobile')::boolean, false) = false or coalesce(pe_mobiles, 0) > 0)
    and (coalesce(f ->> 'title', '') = '' or exists (select 1 from unnest(coalesce(pe_titles, '{}')) t where t ilike '%' || (f ->> 'title') || '%'))
$$;

create or replace function acti_pool_excluded(p_name text, p_domain text, ex_domains text[], ex_names text[], ex_keywords text[])
returns boolean language sql immutable as $$
  select (p_domain is not null and p_domain = any (coalesce(ex_domains, '{}')))
      or lower(p_name) = any (coalesce(ex_names, '{}'))
      or exists (select 1 from unnest(coalesce(ex_keywords, '{}')) k where k <> '' and p_name ilike '%' || k || '%')
$$;

-- Listado paginado. Orden por defecto: empresas con más contactos con
-- celular primero (menor costo de gestión) y luego por nombre.
create or replace function acti_pool_search(
  f jsonb default '{}'::jsonb,
  ex_domains text[] default '{}',
  ex_names text[] default '{}',
  ex_keywords text[] default '{}',
  p_order text default 'contactos',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (hs_id text, name text, domain text, properties jsonb, contacts integer, mobiles integer, areas text[], levels text[], total_count bigint)
language sql stable set search_path = public as $$
  select p.hs_id, p.name, p.domain, p.properties,
         coalesce(pe.contacts, 0), coalesce(pe.mobiles, 0), coalesce(pe.areas, '{}'), coalesce(pe.levels, '{}'),
         count(*) over () as total_count
  from hubspot_company_pool p
  left join acti_company_people pe on pe.domain = p.domain
  where not acti_pool_excluded(p.name, p.domain, ex_domains, ex_names, ex_keywords)
    and acti_pool_match(p.properties, p.name, p.domain, pe.mobiles, pe.areas, pe.levels, pe.titles, f, '')
  order by
    case when p_order = 'nombre' then 0 else -coalesce(pe.mobiles, 0) end,
    case when p_order = 'nombre' then 0 else -coalesce(pe.contacts, 0) end,
    p.name
  limit greatest(1, least(p_limit, 100))
  offset greatest(0, p_offset)
$$;

-- Conteos por opción de cada filtro (top 40 por faceta)
create or replace function acti_pool_facets(
  f jsonb default '{}'::jsonb,
  ex_domains text[] default '{}',
  ex_names text[] default '{}',
  ex_keywords text[] default '{}'
)
returns table (facet text, value text, n bigint)
language sql stable set search_path = public as $$
  with base as (
    select p.name, p.domain, p.properties, pe.mobiles, pe.areas, pe.levels, pe.titles
    from hubspot_company_pool p
    left join acti_company_people pe on pe.domain = p.domain
    where not acti_pool_excluded(p.name, p.domain, ex_domains, ex_names, ex_keywords)
  ),
  vals as (
    select 'industry'::text as facet, b.properties ->> 'industry' as value from base b
      where acti_pool_match(b.properties, b.name, b.domain, b.mobiles, b.areas, b.levels, b.titles, f, 'industry')
    union all
    select 'country', b.properties ->> 'pais_g' from base b
      where acti_pool_match(b.properties, b.name, b.domain, b.mobiles, b.areas, b.levels, b.titles, f, 'country')
    union all
    select 'city', b.properties ->> 'city' from base b
      where acti_pool_match(b.properties, b.name, b.domain, b.mobiles, b.areas, b.levels, b.titles, f, 'city')
    union all
    select 'size', acti_size_bucket(acti_num(b.properties ->> 'numberofemployees')) from base b
      where acti_pool_match(b.properties, b.name, b.domain, b.mobiles, b.areas, b.levels, b.titles, f, 'size')
    union all
    select 'revenue', acti_revenue_bucket(acti_num(b.properties ->> 'annualrevenue')) from base b
      where acti_pool_match(b.properties, b.name, b.domain, b.mobiles, b.areas, b.levels, b.titles, f, 'revenue')
    union all
    select 'tech', t from base b, unnest(acti_techs_raw(b.properties)) t
      where acti_pool_match(b.properties, b.name, b.domain, b.mobiles, b.areas, b.levels, b.titles, f, 'tech')
    union all
    select 'area', a from base b, unnest(coalesce(b.areas, '{}')) a
      where acti_pool_match(b.properties, b.name, b.domain, b.mobiles, b.areas, b.levels, b.titles, f, 'area')
    union all
    select 'level', l from base b, unnest(coalesce(b.levels, '{}')) l
      where acti_pool_match(b.properties, b.name, b.domain, b.mobiles, b.areas, b.levels, b.titles, f, 'level')
    union all
    select 'signal', 'mobile' from base b
      where coalesce(b.mobiles, 0) > 0
        and acti_pool_match(b.properties, b.name, b.domain, b.mobiles, b.areas, b.levels, b.titles, f, 'signal')
  ),
  counted as (
    select v.facet, v.value, count(*) as n,
           row_number() over (partition by v.facet order by count(*) desc, v.value) as rk
    from vals v
    where v.value is not null and v.value <> ''
    group by v.facet, v.value
  )
  select c.facet, c.value, c.n from counted c where c.rk <= 40
$$;

-- Solo el service role (las APIs del servidor) puede ejecutarlas
revoke execute on function acti_pool_search(jsonb, text[], text[], text[], text, integer, integer) from public, anon, authenticated;
grant execute on function acti_pool_search(jsonb, text[], text[], text[], text, integer, integer) to service_role;
revoke execute on function acti_pool_facets(jsonb, text[], text[], text[]) from public, anon, authenticated;
grant execute on function acti_pool_facets(jsonb, text[], text[], text[]) to service_role;
