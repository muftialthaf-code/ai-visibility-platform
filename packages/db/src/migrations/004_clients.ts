export const sql = `
create table onboarding_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  label text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table onboarding_requests (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid references onboarding_invites (id) on delete set null,
  data jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  tenant_id text,
  created_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  decision_note text
);
create index onboarding_requests_status_idx on onboarding_requests (status, created_at);
`;
