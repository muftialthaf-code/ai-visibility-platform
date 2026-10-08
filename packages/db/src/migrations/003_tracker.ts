export const sql = `
create table tracker_results (
  id bigserial primary key,
  tenant_id text not null,
  run_id uuid,
  week date not null,
  at timestamptz not null default now(),
  provider text not null,
  prompt text not null,
  mentioned boolean not null default false,
  cited boolean not null default false,
  position integer,
  competitors jsonb not null default '[]',
  citations jsonb not null default '[]',
  snippet text,
  answer text,
  cost_usd double precision not null default 0,
  error text
);
create index tracker_results_tenant_week_idx on tracker_results (tenant_id, week);

create table search_console_weekly (
  tenant_id text not null,
  week date not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  avg_position double precision,
  top_queries jsonb not null default '[]',
  primary key (tenant_id, week)
);
`;
