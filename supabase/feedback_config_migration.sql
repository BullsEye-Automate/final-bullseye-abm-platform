-- Configuración de preguntas de feedback por cliente
create table if not exists feedback_config (
  id                    uuid primary key default uuid_generate_v4(),
  client_id             uuid references clients(id) on delete cascade not null unique,
  pregunta_calificacion text not null default '¿Cómo calificarías esta reunión?',
  pregunta_empresa      text not null default '¿La empresa es un prospecto calificado?',
  pregunta_contacto     text not null default '¿El contacto era el decisor adecuado?',
  pregunta_propuesta    text not null default '¿Cuál es el próximo paso?',
  pregunta_comentarios  text not null default 'Comentarios adicionales',
  razones_no_califica   text[]  not null default array[
    'No tomaba decisiones',
    'No presentó interés',
    'No tenía contexto de nosotros',
    'Tomó la reunión desde el celular',
    'Otro'
  ],
  propuesta_opciones    text[]  not null default array[
    'Si', 'No', 'No aún', 'Falta otra reunión'
  ],
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create index if not exists feedback_config_client_idx on feedback_config(client_id);
