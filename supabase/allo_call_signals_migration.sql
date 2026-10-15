-- BullsEye · Señales comerciales extraídas de llamadas de Allo
-- Analiza (vía Claude) el transcript de llamadas realmente conectadas para
-- detectar señales de inteligencia comercial B2B (ciclos de presupuesto,
-- procesos de compra, restricciones temporales, rechazos definitivos, etc.),
-- empresas mencionadas en la conversación, y si el prospecto está listo para
-- pasar a gestión comercial directa del cliente.
-- Ejecutar en el SQL editor de Supabase (es idempotente).

create table if not exists allo_call_signals (
  id                   uuid primary key default uuid_generate_v4(),
  client_id            uuid not null references clients(id) on delete cascade,
  allo_call_id         text not null,
  allo_number          text,
  contact_number       text,
  contact_name         text,
  contact_company      text,
  contact_job_title    text,
  call_date            timestamptz,
  call_duration        integer,
  model                text,
  -- Array de { categoria, evidencia, tipo_senal, periodo, certeza, relevancia, relevancia_motivo }
  signals              jsonb not null default '[]'::jsonb,
  -- Array de { nombre, contexto, tipo } — otras empresas nombradas en la llamada
  -- (competidor, proveedor actual, referido), ver lib/alloCallSignals.ts
  mentioned_companies  jsonb not null default '[]'::jsonb,
  top_relevance        text check (top_relevance in ('alta', 'media', 'baja')),
  recommended_action   text,
  follow_up_date       date,
  crm_summary          text,
  reviewed             boolean not null default false,
  analyzed_at          timestamptz not null default now(),
  created_at           timestamptz not null default now()
);

-- Idempotencia: cada llamada de Allo se analiza una sola vez (el cron la
-- descarta de "pendientes" si ya existe esta fila).
create unique index if not exists allo_call_signals_call_unique
  on allo_call_signals (allo_call_id);

create index if not exists allo_call_signals_client_idx
  on allo_call_signals (client_id);

create index if not exists allo_call_signals_relevance_idx
  on allo_call_signals (top_relevance);
