import type { Db } from './types.ts';

/* ---------- onboarding invites and requests ---------- */

export interface Invite {
  id: string;
  label: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

/** Only a hash of the invite token is stored, so a database leak does not leak working links. */
export async function createInvite(db: Db, i: { tokenHash: string; label: string; createdBy: string; expiresAt: Date }): Promise<void> {
  await db.query(`insert into onboarding_invites (token_hash, label, created_by, expires_at) values ($1,$2,$3,$4)`, [i.tokenHash, i.label, i.createdBy, i.expiresAt]);
}

export async function listInvites(db: Db, limit = 50): Promise<Invite[]> {
  return db.query<Invite>(`select id, label, created_by, created_at, expires_at, used_at from onboarding_invites order by created_at desc limit $1`, [limit]);
}

/** Is this token valid right now (known, unused, not expired)? Does not use it up. */
export async function inviteIsOpen(db: Db, tokenHash: string): Promise<{ label: string } | null> {
  const rows = await db.query<{ label: string }>(`select label from onboarding_invites where token_hash = $1 and used_at is null and expires_at > now()`, [tokenHash]);
  return rows[0] ?? null;
}

export async function revokeInvite(db: Db, id: string): Promise<void> {
  await db.query(`update onboarding_invites set used_at = now() where id = $1 and used_at is null`, [id]);
}

/**
 * Submit a request with an invite. The invite is used up in the same statement that checks it, so two
 * submissions racing on one link cannot both succeed. Returns the request id, or null when the invite is not valid.
 */
export async function submitOnboarding(db: Db, tokenHash: string, data: Record<string, unknown>): Promise<string | null> {
  const used = await db.query<{ id: string }>(`update onboarding_invites set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning id`, [tokenHash]);
  if (!used[0]) return null;
  const rows = await db.query<{ id: string }>(`insert into onboarding_requests (invite_id, data) values ($1, $2) returning id`, [used[0].id, JSON.stringify(data)]);
  return rows[0]!.id;
}

export interface OnboardingRequest {
  id: string;
  data: Record<string, any>;
  status: 'pending' | 'accepted' | 'rejected';
  tenant_id: string | null;
  created_at: string;
  decided_by: string | null;
  decision_note: string | null;
}

export async function listOnboarding(db: Db, status?: OnboardingRequest['status']): Promise<OnboardingRequest[]> {
  return db.query<OnboardingRequest>(
    `select id, data, status, tenant_id, created_at, decided_by, decision_note from onboarding_requests where ($1::text is null or status = $1) order by created_at desc limit 100`,
    [status ?? null],
  );
}

export async function getOnboarding(db: Db, id: string): Promise<OnboardingRequest | null> {
  return (await db.query<OnboardingRequest>(`select id, data, status, tenant_id, created_at, decided_by, decision_note from onboarding_requests where id = $1`, [id]))[0] ?? null;
}

/** Record a decision. Only a pending request can be decided, and only once. Returns false if it was already decided. */
export async function decideOnboarding(db: Db, id: string, d: { status: 'accepted' | 'rejected'; by: string; tenantId?: string; note?: string }): Promise<boolean> {
  const rows = await db.query(
    `update onboarding_requests set status = $2, decided_by = $3, decided_at = now(), tenant_id = $4, decision_note = $5 where id = $1 and status = 'pending' returning id`,
    [id, d.status, d.by, d.tenantId ?? null, d.note ?? null],
  );
  return rows.length > 0;
}

/* ---------- billing statement ---------- */

export interface UsageStatementLine {
  tenantId: string;
  articlesWritten: number;
  articlesHeld: number;
  trackerAnswers: number;
  runSeconds: number;
  costUsd: number;
}

/** What each business used in a month (UTC): articles, tracker answers, run time and what the models cost. This is usage, not a price. */
export async function usageStatement(db: Db, month: string): Promise<UsageStatementLine[]> {
  const rows = await db.query<{ tenant_id: string; written: number; held: number; tracker: number; seconds: number; cost: number }>(
    `with t as (select distinct tenant_id from (
        select tenant_id from runs where to_char(started_at at time zone 'UTC','YYYY-MM') = $1
        union select tenant_id from usage_events where to_char(at at time zone 'UTC','YYYY-MM') = $1) x)
     select t.tenant_id,
       (select count(*) from runs r where r.tenant_id = t.tenant_id and r.kind = 'agent' and r.status = 'success' and to_char(r.started_at at time zone 'UTC','YYYY-MM') = $1)::int as written,
       (select count(*) from runs r where r.tenant_id = t.tenant_id and r.kind = 'agent' and r.status = 'held' and to_char(r.started_at at time zone 'UTC','YYYY-MM') = $1)::int as held,
       (select count(*) from tracker_results k where k.tenant_id = t.tenant_id and k.error is null and to_char(k.at at time zone 'UTC','YYYY-MM') = $1)::int as tracker,
       coalesce((select sum(extract(epoch from (r.finished_at - r.started_at))) from runs r where r.tenant_id = t.tenant_id and r.finished_at is not null and to_char(r.started_at at time zone 'UTC','YYYY-MM') = $1), 0)::float8 as seconds,
       coalesce((select sum(cost_usd) from usage_events u where u.tenant_id = t.tenant_id and to_char(u.at at time zone 'UTC','YYYY-MM') = $1), 0)::float8 as cost
     from t order by t.tenant_id`,
    [month],
  );
  return rows.map((r) => ({ tenantId: r.tenant_id, articlesWritten: r.written, articlesHeld: r.held, trackerAnswers: r.tracker, runSeconds: Math.round(r.seconds), costUsd: Math.round(r.cost * 10000) / 10000 }));
}
