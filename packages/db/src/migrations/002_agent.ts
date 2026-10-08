// Agent tables: the topic backlog, notifications, review activity, reminders and scheduled publishes.
export const sql = `
create table topics (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  topic text not null,
  -- The question a reader (or an AI assistant) would ask, which the article answers.
  question text not null,
  persona text,
  intent text,
  sources jsonb not null default '[]',
  priority double precision not null default 0,
  status text not null default 'suggested' check (status in ('suggested', 'approved', 'rejected', 'used', 'duplicate')),
  reason text,
  used_run_id uuid references runs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index topics_tenant_topic_idx on topics (tenant_id, md5(lower(topic)));
create index topics_tenant_status_idx on topics (tenant_id, status, priority desc);

create table notifications (
  id bigserial primary key,
  at timestamptz not null default now(),
  tenant_id text,
  kind text not null,
  subject text not null,
  body text not null default '',
  pr_number integer,
  emailed_at timestamptz,
  email_error text
);
create index notifications_at_idx on notifications (at desc);

-- Everything done in the Review Queue, so rejections and change requests can steer later topics.
create table review_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  tenant_id text not null,
  pr_number integer not null,
  action text not null,
  actor text not null,
  note text
);
create index review_events_pr_idx on review_events (tenant_id, pr_number, at desc);

create table review_reminders (
  tenant_id text not null,
  pr_number integer not null,
  last_sent_at timestamptz not null default now(),
  primary key (tenant_id, pr_number)
);

create table scheduled_publishes (
  id bigserial primary key,
  tenant_id text not null,
  pr_number integer not null,
  publish_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'cancelled', 'failed')),
  error text,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index scheduled_publishes_due_idx on scheduled_publishes (status, publish_at);
`;
