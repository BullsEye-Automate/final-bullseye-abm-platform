-- Link público de solo research (10-09-2026, pedido explícito del usuario):
-- permite compartir el research pre-reunión de UNA reunión puntual con el
-- cliente sin que necesite login a Peitho ni pueda ver nada más (ni otras
-- reuniones, ni el análisis post-reunión, ni la base de conocimiento). El
-- token se genera bajo demanda (POST /meetings/:id/research/share, ver
-- routes/meetings.ts) — queda null hasta que un admin lo pide la primera vez.
alter table meetings add column if not exists research_share_token text;
create unique index if not exists idx_meetings_research_share_token
  on meetings (research_share_token) where research_share_token is not null;
