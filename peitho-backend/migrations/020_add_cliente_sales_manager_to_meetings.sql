-- Ejecutivo/Sales Manager del CLIENTE de BullsEye (ej. CCHC) que toma la
-- reunión — viene de la columna "Sales Manager" del excel de metas. Distinto
-- de `ejecutivo` (reservado para un SDR/ejecutivo de BullsEye, usado en el
-- ranking "por ejecutivo" del Panel de control): en una reunión agendada por
-- invitación manual al bot (Fase H, disparador b) no hay ningún BullsEye en
-- la llamada, `ejecutivo` queda null a propósito, y este campo nuevo es la
-- única forma de saber quién de CCHC la toma. Se llena solo cuando el excel
-- lo tiene relleno para esa fila (no todas las filas lo traen).
alter table meetings add column if not exists cliente_sales_manager text;
