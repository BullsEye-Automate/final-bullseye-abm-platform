-- Nombre de la columna "Cliente" de la planilla API Reuniones. Varios
-- clientes comparten "ID Cliente" (Nisum / Nisum Colombia / Nisum Perú,
-- CChC / CChC - Valle) y el nombre es lo que los separa en Células SDR
-- (lib/celulasSdr/accounts.ts). Lo llena el sync de reuniones.
alter table meetings add column if not exists cliente_nombre text;
