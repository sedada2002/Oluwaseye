create table if not exists brokerage_oauth_tokens (
  connection_id text primary key,
  access_token_ciphertext jsonb not null,
  refresh_token_ciphertext jsonb not null,
  expires_at_epoch_ms numeric(20, 0) not null,
  scope text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists order_ledger (
  sequence_id text not null,
  client_order_id text primary key,
  user_id text not null,
  account_id text not null,
  ticker text not null,
  side text not null check (side in ('BUY', 'SELL')),
  order_type text not null,
  time_in_force text not null,
  notional numeric(20, 4),
  quantity text,
  broker_order_id text,
  state text not null check (state in ('PENDING', 'ROUTING', 'TRANSMITTED', 'PARTIAL', 'FILLED', 'FAILED', 'SLIPPAGE_REJECTED')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_ledger_sequence_id_idx on order_ledger (sequence_id);
create index if not exists order_ledger_user_state_idx on order_ledger (user_id, state);

create table if not exists execution_sequence_alerts (
  id bigserial primary key,
  sequence_id text not null,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists execution_sequence_alerts_sequence_id_idx on execution_sequence_alerts (sequence_id);
