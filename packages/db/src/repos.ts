import type { Db, Role, Run, RunKind, RunStatus, RunTrigger, User } from './types.ts';

/* ---------- users ---------- */

export async function countUsers(db: Db): Promise<number> {
  return (await db.query<{ n: number }>('select count(*)::int as n from users'))[0]!.n;
}

export async function createUser(
  db: Db,
  u: { email: string; passwordHash: string; role: Role; tenantId?: string | null },
): Promise<User> {
  const rows = await db.query<User>(
    `insert into users (email, password_hash, role, tenant_id) values ($1, $2, $3, $4) returning *`,
    [u.email.trim().toLowerCase(), u.passwordHash, u.role, u.tenantId ?? null],
  );
  return rows[0]!;
}

export async function getUserByEmail(db: Db, email: string): Promise<User | null> {
  return (await db.query<User>('select * from users where email = $1', [email.trim().toLowerCase()]))[0] ?? null;
}

export async function getUser(db: Db, id: string): Promise<User | null> {
  return (await db.query<User>('select * from users where id = $1', [id]))[0] ?? null;
}

export async function listUsers(db: Db): Promise<User[]> {
  return db.query<User>('select * from users order by created_at');
}

export async function updateUser(
  db: Db,
  id: string,
  patch: Partial<Pick<User, 'role' | 'tenant_id' | 'disabled' | 'password_hash' | 'totp_secret' | 'totp_enabled' | 'totp_last_step'>>,
): Promise<void> {
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  if (keys.length === 0) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await db.query(`update users set ${sets} where id = $1`, [id, ...keys.map((k) => patch[k])]);
}

/* ---------- login throttling ---------- */

export async function recordLoginAttempt(db: Db, email: string, success: boolean): Promise<void> {
  await db.query('insert into login_attempts (email, success) values ($1, $2)', [email.trim().toLowerCase(), success]);
}

/** Failed attempts since the last success within the window. Used to lock an account out briefly. */
export async function recentFailures(db: Db, email: string, windowMinutes = 15): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `select count(*)::int as n from login_attempts
     where email = $1 and success = false
       and at > now() - ($2 || ' minutes')::interval
       and at > coalesce((select max(at) from login_attempts where email = $1 and success = true), 'epoch')`,
    [email.trim().toLowerCase(), String(windowMinutes)],
  );
  return rows[0]!.n;
}

/* ---------- audit log ---------- */

export interface AuditEntry {
  id: number;
  at: string;
  user_id: string | null;
  user_email: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown>;
}

export async function logAudit(
  db: Db,
  entry: { userId?: string | null; userEmail: string; action: string; target?: string; detail?: Record<string, unknown> },
): Promise<void> {
  await db.query('insert into audit_log (user_id, user_email, action, target, detail) values ($1, $2, $3, $4, $5)', [
    entry.userId ?? null,
    entry.userEmail,
    entry.action,
    entry.target ?? null,
    JSON.stringify(entry.detail ?? {}),
  ]);
}

export async function listAudit(db: Db, limit = 100): Promise<AuditEntry[]> {
  return db.query<AuditEntry>('select * from audit_log order by at desc, id desc limit $1', [limit]);
}

/* ---------- runs ---------- */

export async function startRun(
  db: Db,
  r: { tenantId: string; kind: RunKind; trigger?: RunTrigger; githubRunUrl?: string },
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into runs (tenant_id, kind, status, trigger, github_run_url) values ($1, $2, 'running', $3, $4) returning id`,
    [r.tenantId, r.kind, r.trigger ?? 'schedule', r.githubRunUrl ?? null],
  );
  return rows[0]!.id;
}

export interface RunUpdate {
  status?: RunStatus;
  topic?: string | null;
  articleUrl?: string | null;
  prNumber?: number | null;
  steps?: Run['steps'];
  checks?: Run['checks'];
  sources?: Run['sources'];
  error?: string | null;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  finished?: boolean;
}

const RUN_COLUMNS: Record<keyof Omit<RunUpdate, 'finished'>, string> = {
  status: 'status',
  topic: 'topic',
  articleUrl: 'article_url',
  prNumber: 'pr_number',
  steps: 'steps',
  checks: 'checks',
  sources: 'sources',
  error: 'error',
  costUsd: 'cost_usd',
  tokensIn: 'tokens_in',
  tokensOut: 'tokens_out',
};

export async function updateRun(db: Db, id: string, u: RunUpdate): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [key, column] of Object.entries(RUN_COLUMNS)) {
    const value = u[key as keyof typeof RUN_COLUMNS];
    if (value === undefined) continue;
    params.push(['steps', 'checks', 'sources'].includes(key) ? JSON.stringify(value) : value);
    sets.push(`${column} = $${params.length}`);
  }
  if (u.finished) sets.push('finished_at = now()');
  if (sets.length === 0) return;
  await db.query(`update runs set ${sets.join(', ')} where id = $1`, params);
}

export async function getRun(db: Db, id: string): Promise<Run | null> {
  return (await db.query<Run>('select * from runs where id = $1', [id]))[0] ?? null;
}

export async function listRuns(
  db: Db,
  opts: { tenantId?: string; kind?: RunKind; status?: RunStatus; limit?: number } = {},
): Promise<Run[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.tenantId) where.push(`tenant_id = $${params.push(opts.tenantId)}`);
  if (opts.kind) where.push(`kind = $${params.push(opts.kind)}`);
  if (opts.status) where.push(`status = $${params.push(opts.status)}`);
  params.push(opts.limit ?? 50);
  return db.query<Run>(
    `select * from runs ${where.length ? 'where ' + where.join(' and ') : ''} order by started_at desc limit $${params.length}`,
    params,
  );
}

/** Latest run per tenant for a kind, for the overview screen. */
export async function lastRunPerTenant(db: Db, kind: RunKind = 'agent'): Promise<Record<string, Run>> {
  const rows = await db.query<Run>(
    `select distinct on (tenant_id) * from runs where kind = $1 order by tenant_id, started_at desc`,
    [kind],
  );
  return Object.fromEntries(rows.map((r) => [r.tenant_id, r]));
}

/** Agent activity over the last 7 days, per tenant, for the overview screen. */
export async function weeklyRunStats(db: Db): Promise<Record<string, { published: number; failed: number; held: number }>> {
  const rows = await db.query<{ tenant_id: string; published: number; failed: number; held: number }>(
    `select tenant_id,
            (count(*) filter (where status = 'success' and article_url is not null))::int as published,
            (count(*) filter (where status = 'failed'))::int as failed,
            (count(*) filter (where status = 'held'))::int as held
       from runs where kind = 'agent' and started_at > now() - interval '7 days' group by tenant_id`,
  );
  return Object.fromEntries(rows.map((r) => [r.tenant_id, { published: r.published, failed: r.failed, held: r.held }]));
}

/** Runs that started more than `minutes` ago and never finished (the runner died or timed out). */
export async function markStaleRuns(db: Db, minutes = 90): Promise<number> {
  const rows = await db.query<{ id: string }>(
    `update runs set status = 'failed', finished_at = now(), error = coalesce(error, 'Run did not finish (runner stopped or timed out)')
     where status = 'running' and started_at < now() - ($1 || ' minutes')::interval returning id`,
    [String(minutes)],
  );
  return rows.length;
}

/* ---------- usage and cost ---------- */

export async function addUsage(
  db: Db,
  e: { tenantId: string; runId?: string | null; provider: string; model?: string; tokensIn?: number; tokensOut?: number; costUsd: number },
): Promise<void> {
  await db.query(
    `insert into usage_events (tenant_id, run_id, provider, model, tokens_in, tokens_out, cost_usd) values ($1,$2,$3,$4,$5,$6,$7)`,
    [e.tenantId, e.runId ?? null, e.provider, e.model ?? null, e.tokensIn ?? 0, e.tokensOut ?? 0, e.costUsd],
  );
}

/** Spend for a tenant in a calendar month (UTC), e.g. month = "2026-10". */
export async function monthlyCost(db: Db, tenantId: string, month: string): Promise<number> {
  const rows = await db.query<{ total: number }>(
    `select coalesce(sum(cost_usd), 0)::float8 as total from usage_events
     where tenant_id = $1 and to_char(at at time zone 'UTC', 'YYYY-MM') = $2`,
    [tenantId, month],
  );
  return rows[0]!.total;
}

export async function costByTenant(db: Db, month: string): Promise<Record<string, number>> {
  const rows = await db.query<{ tenant_id: string; total: number }>(
    `select tenant_id, sum(cost_usd)::float8 as total from usage_events
     where to_char(at at time zone 'UTC', 'YYYY-MM') = $1 group by tenant_id`,
    [month],
  );
  return Object.fromEntries(rows.map((r) => [r.tenant_id, r.total]));
}

/* ---------- settings ---------- */

export async function getSetting<T = unknown>(db: Db, key: string, fallback: T): Promise<T> {
  const rows = await db.query<{ value: T }>('select value from settings where key = $1', [key]);
  return rows[0] ? rows[0].value : fallback;
}

export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db.query(
    `insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}
