-- Segundo nivel de rol solo para cuentas "client" (23-09-2026, pedido
-- explícito del usuario — CCHC va a tener ~40 reuniones/mes y varios
-- usuarios del cliente con acceso, no todos deberían ver el panel de
-- control ni la base de conocimiento). 'admin' (default, para no bajarle el
-- acceso a ningún usuario "client" ya creado) ve todo igual que hoy;
-- 'user' queda acotado a reuniones futuras/pasadas + detalle + research.
-- Null para filas con role='admin' (BullsEye) — no aplica.
alter table peitho_user_roles
  add column if not exists client_sub_role text check (client_sub_role in ('admin', 'user'));

update peitho_user_roles set client_sub_role = 'admin' where role = 'client' and client_sub_role is null;
