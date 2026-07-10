-- Agrega timestamp de última investigación profunda para control de TTL
alter table companies
  add column if not exists deep_research_updated_at timestamptz;

-- Backfill: marcar como actualizadas hoy las empresas que ya tienen deep_research
update companies
  set deep_research_updated_at = now()
  where deep_research is not null
    and deep_research_updated_at is null;
