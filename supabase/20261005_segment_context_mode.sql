alter table training_segments
  add column if not exists context_mode text not null default 'all'
  check (context_mode in ('all', 'icp_only', 'segment_only'));
