alter table training_segments
  add column if not exists icp_industry_id uuid references icp_industries(id) on delete set null;
