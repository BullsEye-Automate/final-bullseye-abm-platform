-- Agrega campos de guía de estilo por segmento y campo de foco de mensajes

ALTER TABLE training_segments
  ADD COLUMN IF NOT EXISTS message_focus      text,
  ADD COLUMN IF NOT EXISTS style_tone         text,
  ADD COLUMN IF NOT EXISTS style_rules        text,
  ADD COLUMN IF NOT EXISTS style_avoid        text,
  ADD COLUMN IF NOT EXISTS style_email_length text DEFAULT 'corto';
