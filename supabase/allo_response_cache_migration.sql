-- Caché compartida de respuestas de la API de Allo.
-- Ejecutar en Supabase SQL Editor.
--
-- Los reportes de Análisis SDR (Ranking SDR, Ranking País, Score de
-- Llamadas IA, Salud Telefónica, Análisis Clientes) viven en rutas de API
-- separadas (= funciones serverless separadas en Vercel), y cada una
-- consulta a Allo los mismos números de teléfono para el mismo rango de
-- fechas por separado. Allo limita a 5 requests/segundo para todo el
-- workspace, y un caché solo en memoria de cada función no se comparte
-- entre ellas, así que varios reportes cargando en paralelo (el caso
-- normal al abrir la página) sumaban muchas más peticiones de las que Allo
-- permite, dejando los reportes lentísimos o directamente fallando.
--
-- Esta tabla permite que cualquier función que llame a Allo (sin importar
-- cuál) reutilice una respuesta ya traída por otra, mientras no haya
-- vencido su TTL (ver ALLO_CACHE_TTL_MS en lib/allo.ts).

create table if not exists allo_response_cache (
  cache_key  text primary key,
  response   jsonb not null,
  expires_at timestamptz not null
);

create index if not exists allo_response_cache_expires_idx on allo_response_cache (expires_at);
