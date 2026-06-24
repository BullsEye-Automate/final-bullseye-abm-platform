-- Tabla para guardar correos generados por el agente de contenido
create table if not exists generated_emails (
  id           uuid primary key default uuid_generate_v4(),
  client_id    uuid references clients(id),
  email_type   text not null,          -- 'info', 'referral', 'cold'
  recipient_title text,                -- cargo del destinatario
  referrer_name   text,                -- nombre de quien derivó (si aplica)
  context_notes   text,                -- notas adicionales del SDR
  subject      text,
  body         text not null,
  created_by   text,                   -- email del SDR
  created_at   timestamptz default now()
);
