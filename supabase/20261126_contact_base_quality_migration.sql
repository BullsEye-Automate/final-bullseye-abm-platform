-- Base de contactos: calidad de cada celular y correo (nov-2026, pedido de BullsEye).
-- Solo en nuestra base (no se escribe en HubSpot). La llena lib/baseContactos/quality.ts
-- con las llamadas de Allo, los rebotes de HubSpot y Lemlist y las respuestas
-- «ya no trabajo aquí».
alter table contact_base add column if not exists phone_quality jsonb not null default '{}'::jsonb;  -- { "+569…": { st: ok|sospechoso|malo, why, src, at, calls, days, conn, last } }
alter table contact_base add column if not exists email_quality jsonb not null default '{}'::jsonb;  -- { "correo": { st: malo, why, src, at } }
alter table contact_base add column if not exists left_company jsonb;                                -- { at, why, src }: dejó la empresa (el celular sirve, la empresa no)

create index if not exists contact_base_mobiles_gin on contact_base using gin (mobiles);
create index if not exists contact_base_mobiles_maybe_gin on contact_base using gin (mobiles_maybe);
create index if not exists contact_base_emails_gin on contact_base using gin (emails);
