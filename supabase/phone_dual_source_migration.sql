-- Sprint 4 fase 2 (revisión) — dual phone fields.
-- Lemlist y Lusha pueden devolver teléfonos distintos. Guardamos ambos
-- para que el SDR pueda comparar y elegir cuál llamar.
--
-- - phone (existente)  = teléfono "principal", el último escrito.
-- - phone_lemlist (nuevo) = teléfono que vino de Lemlist (sync nativo).
-- - phone_lusha   (nuevo) = teléfono que vino de Lusha (lookup manual).
-- - phone_source (existente) sigue indicando cuál es el principal.

alter table contacts
  add column if not exists phone_lemlist text,
  add column if not exists phone_lusha   text;
