-- Compartir el análisis (feedback) post-reunión con el cliente (11-09-2026),
-- pedido explícito del usuario: mismo patrón que research_share_token
-- (migración 023) pero para el análisis post-reunión en vez del research
-- pre-reunión — un link público de solo lectura para UNA reunión puntual,
-- sin login a Peitho y sin visibilidad de ninguna otra cosa (ver
-- routes/publicAnalysis.ts).
alter table meetings add column if not exists analysis_share_token text;
create unique index if not exists idx_meetings_analysis_share_token on meetings (analysis_share_token) where analysis_share_token is not null;
