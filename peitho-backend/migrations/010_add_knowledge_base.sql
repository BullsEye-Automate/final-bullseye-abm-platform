-- Peitho — Módulo 3: Base de conocimiento por cliente (Fase C).
-- Documentación que el equipo sube por cliente (ICP, buyer persona,
-- propuesta de valor, casos de éxito, presentaciones) para que el research
-- pre-reunión y el análisis post-reunión puedan usarla (Fase D, todavía no
-- implementada — esta migración solo crea el almacenamiento).

create table if not exists knowledge_base_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) not null,
  file_name text not null,
  file_type text,
  -- Path del archivo original en Supabase Storage (bucket "knowledge-base")
  -- — se guarda el archivo tal cual además del texto extraído, por si la
  -- extracción falla o alguien necesita el archivo original después.
  storage_path text not null,
  -- Texto extraído para usar en los prompts (Fase D). Null si el formato no
  -- se pudo procesar — mejor un documento sin contenido usable que romper
  -- la subida completa.
  content text,
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_knowledge_base_documents_client_id
  on knowledge_base_documents (client_id);
