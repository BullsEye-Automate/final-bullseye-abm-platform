-- Alertas de Números (lib/phoneHealth): estado de cada alerta activa para no
-- repetir el mismo aviso por correo todos los días. Una fila por número de
-- Allo en rojo o amarillo; se borra cuando el número sale de alerta.
create table if not exists phone_health_alerts (
  allo_number text primary key,
  level text not null check (level in ('red', 'yellow')),
  since date not null,          -- día (Chile) desde que está en este nivel
  last_seen date not null,      -- última evaluación que lo vio en alerta
  reasons jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table phone_health_alerts enable row level security;
