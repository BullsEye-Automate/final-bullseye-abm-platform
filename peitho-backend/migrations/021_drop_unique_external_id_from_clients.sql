-- Bug de diseño real (10-09-2026): la maestra de clientes de BullsEye usa el
-- mismo "ID Cliente" para varias filas que en Peitho SÍ deben ser clientes
-- separados (ej. "Nisum" / "Nisum Perú" / "Nisum Colombia" comparten un solo
-- ID porque en otra herramienta de BullsEye son una sola cuenta matriz, pero
-- acá cada variante regional necesita su propio cliente para que el match
-- automático de reuniones por nombre siga funcionando). `external_id unique`
-- rompía justo ese caso real — se saca la restricción (dinámico: el nombre
-- exacto de la constraint autogenerada puede variar) y se deja un índice
-- normal para que las búsquedas por external_id sigan siendo rápidas.
do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute attr on attr.attrelid = rel.oid and attr.attnum = any(con.conkey)
  where rel.relname = 'clients' and con.contype = 'u' and attr.attname = 'external_id';

  if constraint_name is not null then
    execute format('alter table clients drop constraint %I', constraint_name);
  end if;
end $$;

create index if not exists idx_clients_external_id on clients (external_id);
