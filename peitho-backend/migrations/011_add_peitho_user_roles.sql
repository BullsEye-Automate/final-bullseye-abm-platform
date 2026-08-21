-- Fase E — login por cliente + vista admin. Un usuario de Supabase Auth
-- (creado a mano en Supabase Studio, no hay signup público) se mapea acá a
-- un rol: "admin" ve/filtra todos los clientes, "client" solo ve su propio
-- client_id. El backend valida esto en cada request (no solo el frontend).
create table if not exists peitho_user_roles (
  user_id uuid primary key,
  email text not null,
  role text not null check (role in ('admin', 'client')),
  client_id uuid references clients(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_peitho_user_roles_client_id on peitho_user_roles (client_id);
