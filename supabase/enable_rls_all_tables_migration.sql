-- BullsEye · Seguridad: activa RLS en todas las tablas del schema public
-- Ejecutar en el SQL editor de Supabase (es idempotente).
--
-- POR QUÉ: la anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY) es pública — va en el
-- navegador. Con RLS desactivado, cualquiera que la tenga puede leer y
-- escribir las tablas directo por la API REST de Supabase, sin pasar por la
-- app ni por el login.
--
-- POR QUÉ NO ROMPE LA APP: el navegador usa Supabase solo para el login
-- (supabase.auth.*). Todas las consultas a tablas se hacen en el servidor
-- con supabaseAdmin() (service role), que se salta RLS. Activar RLS sin
-- policies deja las tablas cerradas para anon/authenticated y abiertas para
-- el service role.
--
-- ⚠️ ANTES DE CORRER: si alguna herramienta EXTERNA a la app (n8n, Make,
-- Looker/Metabase, scripts, otro repo) consulta Supabase con la anon key,
-- va a dejar de ver datos. Debe pasar a usar la service role key (solo en
-- servidor) o se le crea una policy específica.

-- ============================================================
-- 0. (Opcional) Diagnóstico previo — correr solo esta consulta para ver
--    qué tablas están hoy expuestas
-- ============================================================
-- select tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
-- order by rowsecurity, tablename;

-- ============================================================
-- 1. Activar RLS en todas las tablas de public
-- ============================================================
do $$
declare
  t record;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public' and rowsecurity = false
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
    raise notice 'RLS activado: %', t.tablename;
  end loop;
end $$;

-- ============================================================
-- 2. Vistas: que respeten el RLS de quien consulta
-- ============================================================
-- Por defecto una vista se ejecuta con los permisos de su dueño y se salta
-- el RLS de las tablas de abajo. security_invoker (Postgres 15+) lo corrige.
do $$
declare
  v record;
begin
  for v in
    select viewname from pg_views where schemaname = 'public'
  loop
    begin
      execute format('alter view public.%I set (security_invoker = true)', v.viewname);
      raise notice 'Vista con security_invoker: %', v.viewname;
    exception when others then
      raise notice 'No se pudo ajustar la vista % (%)', v.viewname, sqlerrm;
    end;
  end loop;
end $$;

-- ============================================================
-- 3. Función RPC con security definer
-- ============================================================
-- count_feedback_for_client se salta RLS (security definer) y estaba
-- habilitada para "authenticated". La app solo la llama con service role
-- (app/api/clients/[id]/route.ts), así que se cierra al resto.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'count_feedback_for_client'
  ) then
    revoke execute on function public.count_feedback_for_client(uuid) from public, anon, authenticated;
    grant execute on function public.count_feedback_for_client(uuid) to service_role;
  end if;
end $$;

-- ============================================================
-- 4. Verificación — debe devolver 0 filas
-- ============================================================
select tablename as tabla_sin_rls
from pg_tables
where schemaname = 'public' and rowsecurity = false
order by tablename;
