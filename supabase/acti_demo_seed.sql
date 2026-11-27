-- ACTI · datos de demostración (OPCIONAL, no correr en producción sin revisar).
-- Crea 3 clientes demo marcados como socios ACTI (Freemium, Conecta y Acelera).
-- Requiere antes supabase/20261127_acti_fase1_migration.sql.
-- No crea reuniones: la tabla meetings la llena la planilla de reuniones y
-- un registro inventado aparecería en Células SDR. Para ver el Inicio con
-- reuniones, usa un cliente demo con reuniones de prueba en un entorno aparte.
-- Para borrar: delete from clients where slug like 'demo-acti-%';

insert into clients (name, slug, status, description)
values
  ('Demo ACTI Freemium', 'demo-acti-freemium', 'active', 'Cliente demo de la Red de Negocios ACTI'),
  ('Demo ACTI Conecta',  'demo-acti-conecta',  'active', 'Cliente demo de la Red de Negocios ACTI'),
  ('Demo ACTI Acelera',  'demo-acti-acelera',  'active', 'Cliente demo de la Red de Negocios ACTI')
on conflict (slug) do nothing;

insert into acti_members (client_id, plan, status, joined_at, trial_start, updated_by)
select id,
       case slug when 'demo-acti-freemium' then 'freemium' when 'demo-acti-conecta' then 'conecta' else 'acelera' end,
       case slug when 'demo-acti-freemium' then 'en_prueba' else 'activo' end,
       current_date - 20,
       case slug when 'demo-acti-freemium' then current_date - 20 else null end,
       'seed'
from clients
where slug in ('demo-acti-freemium', 'demo-acti-conecta', 'demo-acti-acelera')
on conflict (client_id) do nothing;

-- Después: en Configuración → Cliente → Portal del cliente — accesos, crea un
-- usuario para cada cliente demo y entra con él: llegará a /acti.
