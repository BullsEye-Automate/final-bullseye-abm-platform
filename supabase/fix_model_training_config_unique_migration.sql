-- Fix: agregar constraint UNIQUE en client_id si no existe
-- Necesario para que el upsert ON CONFLICT funcione en style-guide y otras rutas

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'model_training_config'::regclass
      and contype = 'u'
      and conname = 'model_training_config_client_id_key'
  ) then
    alter table model_training_config
      add constraint model_training_config_client_id_key unique (client_id);
  end if;
end $$;
