// Core tables: users, audit log, login attempts, runs, usage, settings.
export const sql = `
-- Core tables: users, audit log, login attempts, runs, usage, settings.
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('owner', 'editor', 'reviewer', 'client')),
  -- Clients only see their own tenant. Null for staff roles.
  tenant_id text,
  totp_secret text,
  totp_enabled boolean not null default false,
  -- Last accepted 30-second TOTP step, so a code cannot be used twice.
  totp_last_step bigint,
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid,
  user_email text not null,
  action text not null,
  target text,
  detail jsonb not null default '{}'
);
create index audit_log_at_idx on audit_log (at desc);

create table login_attempts (
  id bigserial primary key,
  email text not null,
  at timestamptz not null default now(),
  success boolean not null
);
create index login_attempts_email_at_idx on login_attempts (email, at desc);

-- One row per agent, tracker or deploy execution.
create table runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  kind text not null check (kind in ('agent', 'tracker', 'deploy')),
  status text not null check (status in ('running', 'success', 'failed', 'held', 'skipped')),
  trigger text not null default 'schedule' check (trigger in ('schedule', 'manual', 'retry')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  topic text,
  article_url text,
  pr_number integer,
  steps jsonb not null default '[]',
  checks jsonb not null default '[]',
  sources jsonb not null default '[]',
  error text,
  cost_usd double precision not null default 0,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  github_run_url text
);
create index runs_tenant_started_idx on runs (tenant_id, started_at desc);
create index runs_status_idx on runs (status);

-- Every billable model or search call, for per-tenant cost reporting and budget caps.
create table usage_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  tenant_id text not null,
  run_id uuid references runs (id) on delete set null,
  provider text not null,
  model text,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_usd double precision not null default 0
);
create index usage_events_tenant_at_idx on usage_events (tenant_id, at desc);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
`;
