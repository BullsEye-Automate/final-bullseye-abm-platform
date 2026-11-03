-- Prospección v3 (oct-2026): dashboard de la nueva forma de prospectar,
-- búsqueda manual de empresas con pocos contactos y switch de Peitho.

-- Peitho (feedback automático de reuniones) contratado por el cliente
alter table client_configs add column if not exists peitho_enabled boolean not null default false;

-- Origen del contacto de la wishlist: búsqueda automática o agregado a mano
-- por el prospector desde /busqueda-manual (LinkedIn / Sales Navigator)
alter table wishlist_contacts add column if not exists origin text not null default 'auto';
alter table wishlist_contacts drop constraint if exists wishlist_contacts_origin_check;
alter table wishlist_contacts add constraint wishlist_contacts_origin_check check (origin in ('auto', 'manual'));
alter table wishlist_contacts add column if not exists added_by_email text;

-- Estado de la búsqueda manual de una empresa con pocos contactos
alter table client_wishlist add column if not exists manual_status text not null default 'pending';
alter table client_wishlist drop constraint if exists client_wishlist_manual_status_check;
alter table client_wishlist add constraint client_wishlist_manual_status_check
  check (manual_status in ('pending', 'in_progress', 'done', 'no_contacts'));
alter table client_wishlist add column if not exists manual_by_email text;
alter table client_wishlist add column if not exists manual_updated_at timestamptz;

create index if not exists client_wishlist_contacts_status_idx on client_wishlist (contacts_status, manual_status);
