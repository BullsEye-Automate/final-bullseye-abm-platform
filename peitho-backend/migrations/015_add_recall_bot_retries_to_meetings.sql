-- Fase H — reintento automático cuando el bot falla al entrar por un error
-- transitorio de Google (ej. "sso_not_configured" intermitente, confirmado
-- real: el mismo login que Recall reporta "Ready" a veces es rechazado por
-- Google al momento real de unirse, y un segundo intento simplemente
-- funciona). Cuenta cuántas veces ya se reintentó una reunión para no
-- reintentar sin límite si el fallo es de verdad permanente.
alter table meetings add column if not exists recall_bot_retries integer not null default 0;
