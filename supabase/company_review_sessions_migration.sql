-- ── Migración: Sistema de revisión de empresas por cliente ──────────────
-- Ejecutar en Supabase SQL Editor

-- 1. Ampliar el CHECK constraint de companies.status para incluir
--    los estados intermedios client_approved y client_rejected
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_status_check;
ALTER TABLE companies ADD CONSTRAINT companies_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'client_approved', 'client_rejected'));

-- 2. Tabla de sesiones de revisión (una por batch compartido)
CREATE TABLE IF NOT EXISTS company_review_sessions (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   uuid REFERENCES clients(id) NOT NULL,
  token       text NOT NULL UNIQUE,
  label       text,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz DEFAULT now(),
  created_by  text
);

-- 3. Tabla de items por sesión (qué empresas pertenecen al batch)
CREATE TABLE IF NOT EXISTS company_review_session_items (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  uuid REFERENCES company_review_sessions(id) ON DELETE CASCADE NOT NULL,
  company_id  uuid REFERENCES companies(id) NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(session_id, company_id)
);

-- Índices de rendimiento
CREATE INDEX IF NOT EXISTS idx_review_sessions_client ON company_review_sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_review_sessions_token  ON company_review_sessions(token);
CREATE INDEX IF NOT EXISTS idx_review_items_session   ON company_review_session_items(session_id);
CREATE INDEX IF NOT EXISTS idx_review_items_company   ON company_review_session_items(company_id);
CREATE INDEX IF NOT EXISTS idx_companies_status       ON companies(status);
