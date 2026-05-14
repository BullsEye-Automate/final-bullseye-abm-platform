-- Sprint 5 fase 8 — loop de feedback Clay → app
-- Cuando Clay corre Find People y devuelve 0 contactos para una empresa,
-- dispara un webhook al endpoint /api/clay/company-no-contacts que marca
-- esta columna. La UI de /empresas muestra un aviso y el usuario sabe que
-- tiene que buscar contactos por otra vía (ej. "Buscar contactos en la web").
--
-- Pega esto en el SQL editor de Supabase y ejecuta. Idempotente.

alter table companies
  add column if not exists clay_no_contacts_at timestamptz;
