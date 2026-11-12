-- Pedido explícito del usuario (12-11-2026): algunos clientes no quieren que
-- un bot visible se una a la videollamada — para esos, Peitho va a capturar
-- el audio con la extensión de Chrome (ya existía, ver peitho-chrome-extension/,
-- construida en la Tarea 4 original y pausada cuando se migró al bot de
-- Recall) en vez de agendar un bot. Decisión explícita del usuario: cuando un
-- cliente queda en modo "extension", el bot deja de agendarse por completo
-- para sus reuniones (no conviven ambos mecanismos a la vez).
alter table clients add column if not exists capture_mode text not null default 'bot';

alter table clients drop constraint if exists clients_capture_mode_check;
alter table clients add constraint clients_capture_mode_check
  check (capture_mode in ('bot', 'extension'));
