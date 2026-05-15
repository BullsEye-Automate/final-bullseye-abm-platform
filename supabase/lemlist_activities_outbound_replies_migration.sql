-- Sprint 6 fase 3 — Responder desde la app (Lemlist Inbox API)
--
-- Permite que el SDR responda a un lead (LinkedIn o email) directamente
-- desde el módulo /respuestas, sin entrar a Lemlist ni a LinkedIn. La app
-- llama a la API de Inbox de Lemlist (POST /api/inbox/linkedin y
-- POST /api/inbox/email) y Lemlist manda el mensaje por la cuenta
-- conectada del usuario.
--
-- Estas columnas guardan lo que se mandó desde la app, para trazabilidad
-- y para que la UI muestre "Respondido ✓" sin re-consultar a Lemlist.
--
-- Pega esto en el SQL editor de Supabase y ejecuta. Idempotente.

alter table lemlist_activities
  add column if not exists reply_sent_text  text,
  add column if not exists reply_sent_at    timestamptz,
  add column if not exists reply_send_error text;
