-- Links públicos para compartir el dashboard de /oportunidades/resultados
-- con un cliente externo. El token resuelve a un client_id y un rango de
-- fechas fijo (definidos por el equipo de BullsEye al generar el link) —
-- el cliente nunca puede cambiar el client_id ni el rango desde la URL.
create table if not exists resultados_share_links (
  id         uuid primary key default uuid_generate_v4(),
  token      uuid not null unique default uuid_generate_v4(),
  client_id  uuid references clients(id) not null,
  desde      date,
  hasta      date,
  created_at timestamptz default now()
);

create index if not exists resultados_share_links_token_idx on resultados_share_links(token);
