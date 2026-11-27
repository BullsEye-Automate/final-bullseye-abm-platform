-- ACTI · Red de Negocios — Fase 3 (Reuniones, feedback del socio y Facturación)
-- Solo tablas NUEVAS (prefijo acti_). No modifica tablas existentes.
-- Idempotente. Requiere las migraciones de las Fases 1 y 2.

-- ============================================================
-- 1. Feedback del socio por reunión
-- ============================================================
-- Complementa meeting_feedback (la encuesta de siempre, que también se llena
-- desde ACTI) con lo propio de ACTI: si el socio confirma que la reunión se
-- realizó (alimenta la facturación) y la calificación del perfil contactado.
create table if not exists acti_meeting_feedback (
  meeting_id     uuid primary key references meetings(id) on delete cascade,
  client_id      uuid not null references clients(id) on delete cascade,
  realizada      boolean not null,               -- el socio confirma que ocurrió
  perfil_rating  integer check (perfil_rating between 1 and 5),
  perfil_ok      boolean,                         -- ¿era el perfil que pidió?
  oportunidad    text check (oportunidad in ('si', 'no', 'aun_no', 'otra_reunion')),
  comentario     text,
  -- Si el socio dice que NO se realizó pero la planilla dice que sí: en revisión
  -- del equipo (no se cobra hasta resolver). cobrar / no_cobrar = resuelta.
  disputa        text check (disputa in ('en_revision', 'cobrar', 'no_cobrar')),
  disputa_por    text,
  disputa_at     timestamptz,
  submitted_by   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists acti_meeting_feedback_client_idx on acti_meeting_feedback (client_id, created_at desc);
alter table acti_meeting_feedback enable row level security;

drop trigger if exists acti_meeting_feedback_set_updated_at on acti_meeting_feedback;
create trigger acti_meeting_feedback_set_updated_at
  before update on acti_meeting_feedback
  for each row execute function set_updated_at();

-- ============================================================
-- 2. Facturación mensual por socio
-- ============================================================
-- Un cierre por socio y mes con los montos congelados (si después cambian los
-- precios de la configuración, los meses cerrados no cambian). El mes en curso
-- se calcula en vivo (lib/acti/billing.ts).
create table if not exists acti_billing_months (
  id                 uuid primary key default uuid_generate_v4(),
  client_id          uuid not null references clients(id) on delete cascade,
  month              text not null,                -- 'YYYY-MM'
  plan               text not null,
  member_status      text,
  base_uf            numeric not null default 0,
  per_meeting_uf     numeric not null default 0,
  meetings_charged   integer not null default 0,   -- reuniones que se cobran
  meetings_done      integer not null default 0,   -- realizadas según la planilla
  meetings_no_show   integer not null default 0,   -- no asistió el prospecto (sin cargo)
  meetings_disputed  integer not null default 0,   -- en revisión (sin cargo hasta resolver)
  variable_uf        numeric not null default 0,
  subtotal_uf        numeric not null default 0,
  iva_pct            numeric not null default 19,
  iva_uf             numeric not null default 0,
  total_uf           numeric not null default 0,
  uf_value           numeric,                      -- CLP por UF usado
  uf_date            date,
  total_clp          numeric,
  revenue_share_pct  numeric not null default 10,
  revenue_share_uf   numeric not null default 0,   -- para ACTI: % de la base, no del variable
  revenue_share_clp  numeric,
  detail             jsonb not null default '{}'::jsonb, -- reuniones incluidas (id, empresa, fecha, estado)
  status             text not null default 'cerrado' check (status in ('cerrado', 'anulado')),
  closed_by          text,
  closed_at          timestamptz not null default now(),
  unique (client_id, month)
);
create index if not exists acti_billing_months_month_idx on acti_billing_months (month);
alter table acti_billing_months enable row level security;
