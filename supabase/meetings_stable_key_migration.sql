-- Migración: clave estable para sync de reuniones (reemplaza sheet_row_key
-- basado en posición de fila por uno basado en contenido: empresa + contacto
-- + fecha de reunión). Ver lib/syncMeetings.ts para la misma fórmula en JS.
--
-- CONTEXTO: sheet_row_key se calculaba como "<spreadsheetId>::<numero_fila>".
-- Si alguien reordenaba/insertaba/borraba filas en el Google Sheet, la
-- reunión que antes vivía en la fila N pasaba a otra posición, dejaba de
-- matchear con su registro en Supabase, y el sync la volvía a crear como
-- reunión nueva (sin feedback) — dejando la original (con feedback) huérfana.
-- Resultado: empresas duplicadas, feedback real "perdido" en el duplicado
-- huérfano.
--
-- ORDEN DE EJECUCIÓN (uno por uno, revisando el resultado antes de seguir):
--   1. Ejecutar el PASO 1 (solo lectura) y revisar los grupos que muestra.
--   2. Recién si el resultado tiene sentido, ejecutar el PASO 2 (borra los
--      duplicados perdedores). Es irreversible — revisá el PASO 1 primero.
--   3. Ejecutar el PASO 3 (recalcula sheet_row_key con la fórmula nueva).
--      Debe correr DESPUÉS del PASO 2 (sheet_row_key es una columna unique,
--      y dos duplicados no pueden compartir la misma clave nueva).
--
-- Esto debe correr ANTES de que el código nuevo de lib/syncMeetings.ts
-- quede desplegado y corra el próximo sync (cron diario 9am) — si el sync
-- corre con la key vieja todavía en la base, va a generar otra tanda de
-- duplicados.

-- ────────────────────────────────────────────────────────────────────────
-- PASO 1 (solo lectura) — ver qué grupos de reuniones quedarían "fusionados"
-- bajo la clave nueva, y cuál sería la reunión "ganadora" (la que se
-- conserva) de cada grupo.
-- ────────────────────────────────────────────────────────────────────────
with claves as (
  select
    id,
    empresa,
    contacto_nombre,
    fecha_reunion,
    feedback_status,
    client_id,
    updated_at,
    created_at,
    regexp_replace(
      translate(lower(trim(coalesce(empresa, ''))), 'áéíóúüñ', 'aeiouun'),
      '\s+', ' ', 'g'
    ) || '|' ||
    regexp_replace(
      translate(lower(trim(coalesce(contacto_nombre, ''))), 'áéíóúüñ', 'aeiouun'),
      '\s+', ' ', 'g'
    ) || '|' || coalesce(fecha_reunion::text, '') as match_key
  from meetings
),
rankeadas as (
  select *,
    row_number() over (
      partition by match_key
      order by
        (feedback_status = 'con_feedback') desc,  -- preferir el que tiene feedback
        updated_at desc,                           -- después, el más reciente
        created_at desc
    ) as rn,
    count(*) over (partition by match_key) as grupo_size
  from claves
)
select match_key, id, empresa, contacto_nombre, fecha_reunion, feedback_status,
       client_id, created_at, updated_at,
       case when rn = 1 then 'SE CONSERVA' else 'SE BORRARÍA (paso 2)' end as accion
from rankeadas
where grupo_size > 1
order by match_key, rn;

-- ────────────────────────────────────────────────────────────────────────
-- PASO 2 (destructivo) — borra los duplicados "perdedores" de cada grupo.
-- Revisá el resultado del PASO 1 antes de correr esto.
-- ────────────────────────────────────────────────────────────────────────
-- with claves as (
--   select
--     id,
--     regexp_replace(
--       translate(lower(trim(coalesce(empresa, ''))), 'áéíóúüñ', 'aeiouun'),
--       '\s+', ' ', 'g'
--     ) || '|' ||
--     regexp_replace(
--       translate(lower(trim(coalesce(contacto_nombre, ''))), 'áéíóúüñ', 'aeiouun'),
--       '\s+', ' ', 'g'
--     ) || '|' || coalesce(fecha_reunion::text, '') as match_key,
--     feedback_status, updated_at, created_at
--   from meetings
-- ),
-- rankeadas as (
--   select id,
--     row_number() over (
--       partition by match_key
--       order by (feedback_status = 'con_feedback') desc, updated_at desc, created_at desc
--     ) as rn
--   from claves
-- )
-- delete from meetings
-- where id in (select id from rankeadas where rn > 1);

-- ────────────────────────────────────────────────────────────────────────
-- PASO 3 — recalcular sheet_row_key con la fórmula nueva (misma que
-- buildMatchKey() en lib/syncMeetings.ts). Correr después del PASO 2.
-- ────────────────────────────────────────────────────────────────────────
-- update meetings set sheet_row_key =
--   regexp_replace(
--     translate(lower(trim(coalesce(empresa, ''))), 'áéíóúüñ', 'aeiouun'),
--     '\s+', ' ', 'g'
--   ) || '|' ||
--   regexp_replace(
--     translate(lower(trim(coalesce(contacto_nombre, ''))), 'áéíóúüñ', 'aeiouun'),
--     '\s+', ' ', 'g'
--   ) || '|' || coalesce(fecha_reunion::text, '');
