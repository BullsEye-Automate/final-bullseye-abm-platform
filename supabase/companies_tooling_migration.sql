-- Adds tool_primary, tool_secondary, company_type to companies.
-- These are used by messageGenerator and hubspotPush for personalization.
alter table companies
  add column if not exists company_type    text,
  add column if not exists tool_primary    text,
  add column if not exists tool_secondary  text;
