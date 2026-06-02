-- Segmentos de entrenamiento por cliente
create table if not exists training_segments (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade not null,
  name text not null,
  description text,
  routing_hint text not null default '',
  created_at timestamptz default now()
);

-- Fuentes de conocimiento por segmento
create table if not exists segment_sources (
  id uuid primary key default uuid_generate_v4(),
  segment_id uuid references training_segments(id) on delete cascade not null,
  source_type text not null default 'text' check (source_type in ('text', 'url', 'document')),
  title text,
  content text,
  url text,
  created_at timestamptz default now()
);

-- Agregar segment_id a message_examples
alter table message_examples add column if not exists segment_id uuid references training_segments(id) on delete set null;

-- Índices
create index if not exists training_segments_client_id_idx on training_segments(client_id);
create index if not exists segment_sources_segment_id_idx on segment_sources(segment_id);
create index if not exists message_examples_segment_id_idx on message_examples(segment_id);
