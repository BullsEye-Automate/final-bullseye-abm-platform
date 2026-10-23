-- Token de la app privada de HubSpot de cada cliente (solo lectura). Lo usa
-- el módulo Células SDR para sumar las actividades (correo / WhatsApp /
-- LinkedIn) que los SDR registran en el HubSpot del cliente. Los clientes
-- sin token se trabajan en el HubSpot de BullsEye (HUBSPOT_ACCESS_TOKEN).
-- Nunca se devuelve al navegador (ver /api/clients/[id]/hubspot).
-- client_configs ya tiene RLS activado (enable_rls_all_tables_migration.sql).
alter table client_configs add column if not exists hubspot_access_token text;
