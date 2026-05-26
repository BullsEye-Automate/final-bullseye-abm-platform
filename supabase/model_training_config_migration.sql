-- BullsEye · Model training config por cliente
create table if not exists model_training_config (
  id                             uuid primary key default uuid_generate_v4(),
  client_id                      uuid not null references clients(id) on delete cascade,
  version                        int not null default 1,
  is_active                      boolean not null default true,
  business_description           text,
  target_buyer_persona           text,
  value_props                    text,
  talking_points                 text,
  strong_decision_maker_keywords text[],
  exclude_role_keywords          text[],
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  unique (client_id)
);

create index if not exists model_training_config_client_idx
  on model_training_config (client_id);
