-- Fase H — invitación manual del bot de Recall a una reunión (ver CLAUDE.md).
-- Estas reuniones no viven en el calendario de ningún ejecutivo de BullsEye
-- (el link no siempre es de Google Meet, ej. Microsoft Teams), así que no
-- alcanza con meet_code (asume meet.google.com/{code}) — se guarda la URL
-- completa tal cual se detectó en el evento del calendario del bot.
alter table meetings add column if not exists meeting_url text;
