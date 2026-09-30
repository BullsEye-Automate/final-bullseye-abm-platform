-- Bug real (08/09-10-2026, cuenta de bot@peithob2b.com): el refresh_token de
-- Google quedó inválido (invalid_grant) — probablemente al habilitar el SSO
-- de terceros para el bot (Recall), que fuerza el re-login de la cuenta a
-- través del IdP externo y parece invalidar sesiones OAuth ya emitidas. El
-- job de respaldo (catchUpAllActiveChannels, cada 15 min) intentó sincronizar
-- este canal decenas de veces y falló todas, pero solo quedó en los logs de
-- Railway — nadie se enteró hasta que una reunión real (Callegari
-- Automotriz/OTIC CChC) no apareció nunca en la app. Estas columnas hacen
-- visible ese estado desde la propia app en vez de depender de revisar logs.
alter table google_credentials add column if not exists last_sync_ok_at timestamptz;
alter table google_credentials add column if not exists last_sync_error text;
alter table google_credentials add column if not exists last_sync_error_at timestamptz;
