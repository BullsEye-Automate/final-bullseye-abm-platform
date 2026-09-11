-- El renovador/catch-up automático de Calendar (calendarWatchRenewal.ts) trata
-- toda cuenta conectada en google_credentials como "debe tener un watch de
-- Calendar activo". Eso no sirve para una cuenta que solo se necesita para
-- leer el excel de metas (METAS_SHEET_GOOGLE_ACCOUNT_EMAIL) sin querer que
-- Peitho rastree ese calendario personal — bug real (11-09-2026): al
-- desconectar jkarmy@bullseye-abm.com de Calendar borrando su fila de
-- google_credentials, se rompió también la lectura del excel de metas para
-- TODA la app, porque esa misma fila hacía las dos cosas.
alter table google_credentials
  add column if not exists calendar_watch_enabled boolean not null default true;
