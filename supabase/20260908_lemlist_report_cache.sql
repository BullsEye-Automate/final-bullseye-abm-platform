create table if not exists lemlist_report_cache (
  client_id  text    not null,
  period     text    not null,
  data       jsonb   not null,
  fetched_at timestamptz default now(),
  primary key (client_id, period)
);
