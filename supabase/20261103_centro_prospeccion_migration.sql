-- BullsEye · Centro de prospección (Prospección → Centro de prospección)
-- Migración del artifact "Centro de prospección BullsEye" (claude.ai) al portal.
--
-- Se replica 1:1 el modelo de documentos del artifact (colección + id de
-- documento + datos JSON + versión) para que la página, las tareas
-- programadas (vía el conector MCP /api/centro/mcp) y el skill de fichas
-- sigan usando exactamente los mismos campos.
--
-- Colecciones: clientes, solicitudes, registro, plan, cuentas, mantenimiento,
-- docs_cliente, historial, vinculos, config, adjuntos, resultados.
--
-- Acceso: solo desde el servidor con service role (RLS activo sin policies,
-- igual que el resto de las tablas del portal).
-- Ejecutar en el SQL editor de Supabase (es idempotente).

create table if not exists centro_docs (
  collection  text        not null,
  doc_id      text        not null,
  data        jsonb       not null default '{}'::jsonb,
  -- Control de concurrencia optimista (equivale al if_version del artifact)
  version     integer     not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text,
  primary key (collection, doc_id)
);

alter table centro_docs drop constraint if exists centro_docs_collection_check;
alter table centro_docs add constraint centro_docs_collection_check check (collection in (
  'clientes', 'solicitudes', 'registro', 'plan', 'cuentas', 'mantenimiento',
  'docs_cliente', 'historial', 'vinculos', 'config', 'adjuntos', 'resultados'
));

create index if not exists centro_docs_updated_idx on centro_docs (updated_at);
create index if not exists centro_docs_cliente_idx on centro_docs (collection, (data->>'clienteId'));
create index if not exists centro_docs_semana_idx  on centro_docs (collection, (data->>'semana'));
create index if not exists centro_docs_estado_idx  on centro_docs (collection, (data->>'estado'));

-- Bitácora: cada escritura (quién, qué, desde dónde). Los borrados quedan
-- aquí para que la página los sincronice (la página consulta cambios
-- desde su última lectura).
create table if not exists centro_docs_log (
  id          bigserial   primary key,
  collection  text        not null,
  doc_id      text        not null,
  action      text        not null check (action in ('set', 'update', 'delete')),
  version     integer,
  by_email    text,
  source      text        not null default 'portal' check (source in ('portal', 'automation', 'migration')),
  created_at  timestamptz not null default now()
);
create index if not exists centro_docs_log_created_idx on centro_docs_log (created_at);
create index if not exists centro_docs_log_doc_idx on centro_docs_log (collection, doc_id, created_at desc);

-- Escritura atómica con versión.
--   p_mode 'set'    = reemplaza el documento (lo crea si no existe)
--   p_mode 'update' = mezcla los campos de primer nivel (falla si no existe)
--   p_mode 'merge'  = mezcla y crea si no existe (lo usa la importación)
--   p_if_version    = si viene, solo escribe si la versión actual coincide
--                     (si no coincide devuelve status 'conflict')
-- Devuelve {status: ok | conflict | not_found, version, updated_at}.
-- Los campos con valor {"__delete__": true} en un update se eliminan.
create or replace function centro_docs_write(
  p_collection text,
  p_doc_id     text,
  p_data       jsonb,
  p_mode       text,
  p_if_version integer,
  p_by         text,
  p_source     text
) returns jsonb
language plpgsql
as $$
declare
  cur  centro_docs;
  res  centro_docs;
  merged jsonb;
  k text;
begin
  select * into cur from centro_docs
   where collection = p_collection and doc_id = p_doc_id
   for update;

  if not found then
    if p_mode = 'update' then
      return jsonb_build_object('status', 'not_found');
    end if;
    if p_if_version is not null then
      return jsonb_build_object('status', 'conflict', 'version', null);
    end if;
    insert into centro_docs (collection, doc_id, data, version, updated_by)
    values (p_collection, p_doc_id, p_data, 1, p_by)
    returning * into res;
  else
    if p_if_version is not null and p_if_version <> cur.version then
      return jsonb_build_object('status', 'conflict', 'version', cur.version);
    end if;
    if p_mode = 'set' then
      merged := p_data;
    else
      merged := cur.data || p_data;
      for k in select key from jsonb_each(p_data) where value = '{"__delete__": true}'::jsonb loop
        merged := merged - k;
      end loop;
    end if;
    update centro_docs
       set data = merged, version = cur.version + 1, updated_at = now(), updated_by = p_by
     where collection = p_collection and doc_id = p_doc_id
     returning * into res;
  end if;

  insert into centro_docs_log (collection, doc_id, action, version, by_email, source)
  values (p_collection, p_doc_id, case when p_mode = 'set' then 'set' else 'update' end, res.version, p_by, coalesce(p_source, 'portal'));

  return jsonb_build_object('status', 'ok', 'version', res.version, 'updated_at', res.updated_at);
end;
$$;

-- Borrado con versión opcional. Devuelve {status: ok | conflict | not_found}.
create or replace function centro_docs_delete(
  p_collection text,
  p_doc_id     text,
  p_if_version integer,
  p_by         text,
  p_source     text
) returns jsonb
language plpgsql
as $$
declare
  cur centro_docs;
begin
  select * into cur from centro_docs
   where collection = p_collection and doc_id = p_doc_id
   for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if p_if_version is not null and p_if_version <> cur.version then
    return jsonb_build_object('status', 'conflict', 'version', cur.version);
  end if;
  delete from centro_docs where collection = p_collection and doc_id = p_doc_id;
  insert into centro_docs_log (collection, doc_id, action, version, by_email, source)
  values (p_collection, p_doc_id, 'delete', cur.version, p_by, coalesce(p_source, 'portal'));
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Archivos de los documentos de cada cliente (brochures, presentaciones…).
-- id = 32 caracteres hex (mismo formato que los assets del artifact, así los
-- documentos migrados conservan su assetId).
create table if not exists centro_assets (
  id            text        primary key,
  storage_path  text        not null,
  content_type  text,
  size_bytes    integer,
  file_name     text,
  uploaded_by   text,
  created_at    timestamptz not null default now()
);

alter table centro_docs     enable row level security;
alter table centro_docs_log enable row level security;
alter table centro_assets   enable row level security;

-- Las funciones solo las llama el servidor (service role).
revoke all on function centro_docs_write(text, text, jsonb, text, integer, text, text) from public, anon, authenticated;
revoke all on function centro_docs_delete(text, text, integer, text, text) from public, anon, authenticated;

-- Bucket privado para los archivos (también lo crea la app si falta).
insert into storage.buckets (id, name, public)
values ('centro-prospeccion', 'centro-prospeccion', false)
on conflict (id) do nothing;
