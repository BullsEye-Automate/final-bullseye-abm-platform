-- Roster de ejecutivos por cliente (23-09-2026, pedido explícito del
-- usuario) — reemplaza la dependencia total de la columna "Sales Manager"
-- del excel de metas (texto libre, mayoría de filas vacías, ver metasSheet.ts)
-- como única fuente de "quién de CChC tomó esta reunión". Ahora BullsEye (o
-- un "admin cliente") mantiene una lista propia de ejecutivos por cliente, y
-- cada reunión se vincula a uno de esos ejecutivos — automático cuando el
-- texto de cliente_sales_manager calza con un nombre del roster
-- (matchClientExecutiveName en metasSheet.ts), o a mano por cualquier
-- usuario "client" de esa empresa cuando quedó vacío o mal.
create table if not exists client_executives (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) not null,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_client_executives_client_id on client_executives (client_id);

alter table meetings
  add column if not exists client_executive_id uuid references client_executives(id) on delete set null;
