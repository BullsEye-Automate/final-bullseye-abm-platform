-- Segunda señal para vincular el ejecutivo del cliente a una reunión
-- (23-09-2026, pedido explícito del usuario): además del texto de
-- cliente_sales_manager (columna "Sales Manager" del excel, casi siempre
-- vacía), ahora también se guarda quién ORGANIZÓ la invitación en el
-- calendario del bot (Fase H, disparador b) — normalmente el ejecutivo
-- comercial del cliente en persona, con su nombre real en el email
-- (ej. "raul.ameller@cchc.cl"). Ver extractContraparteFromBotInvite en
-- calendarSync.ts (ya calculaba organizerEmail para EXCLUIRLO al buscar al
-- prospecto — esto solo lo persiste en vez de descartarlo) y
-- matchClientExecutiveId en metasSheet.ts (usa esto como señal PRIMARIA,
-- más confiable que el texto libre del excel).
alter table meetings
  add column if not exists organizer_email text,
  add column if not exists organizer_name text;
