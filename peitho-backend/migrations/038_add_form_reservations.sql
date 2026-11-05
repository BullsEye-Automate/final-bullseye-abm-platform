-- Pedido explícito del usuario (05-11-2026): el formulario de reuniones de
-- BullsEye (Google Apps Script, Hubspot-y-SDR-Dashboard) ahora empuja cada
-- reunión agendada directo a Peitho por webhook, además de escribirla en el
-- excel de metas de siempre — ver POST /webhooks/bullseye-form. Esta tabla
-- guarda esa copia: sirve como respaldo cuando la lectura en vivo del excel
-- falla (token de Google muerto, cuota, timeout — ver loadReunionesRows en
-- metasSheet.ts) y como fuente más rápida/confiable que parsear columnas de
-- una hoja de cálculo mantenida a mano.
--
-- id_reunion = el mismo UUID que el Apps Script ya genera para la columna
-- "ID Reunión" del excel (metas_sheet_match_id en meetings) — upsert por esa
-- clave para que un reenvío del mismo formulario (reintento de red del Apps
-- Script) nunca duplique la fila.
create table if not exists form_reservations (
  id_reunion text primary key,
  cliente text,
  id_cliente text,
  origen text,
  sdr text,
  empresa text,
  contacto text,
  cargo text,
  industria text,
  pais text,
  sales_manager text,
  correo text,
  telefono text,
  linkedin_url text,
  fecha_agendamiento text,
  fecha_reunion text,
  hora text,
  comentario text,
  propuesta text,
  realizado text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_form_reservations_correo on form_reservations (lower(correo));
