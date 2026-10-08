import { beforeEach, describe, expect, it } from 'vitest';
import {
  addUsage, connect, costByTenant, countUsers, createUser, getSetting, getUserByEmail, lastRunPerTenant, listAudit, listRuns,
  logAudit, markStaleRuns, weeklyRunStats, migrate, monthlyCost, recentFailures, recordLoginAttempt, setSetting, startRun, updateRun, updateUser, getRun,
  type Db,
} from './index.ts';

let db: Db;
beforeEach(async () => {
  db = await connect('pglite://memory');
  await migrate(db);
});

describe('migrate', () => {
  it('is idempotent', async () => {
    expect(await migrate(db)).toEqual([]);
  });

  it('applies nothing from a migration that fails halfway', async () => {
    const fresh = await connect('pglite://memory');
    await expect(migrate(fresh, [{ name: '001_bad', sql: 'create table half_done (id int); select * from does_not_exist;' }])).rejects.toThrow();
    const rows = await fresh.query(`select to_regclass('public.half_done') as t`);
    expect(rows[0].t).toBeNull();
    expect(await fresh.query('select * from schema_migrations')).toEqual([]);
  });
});

describe('users and login throttling', () => {
  it('creates users with normalised email and enforces uniqueness', async () => {
    await createUser(db, { email: ' Mufti@Example.com ', passwordHash: 'x', role: 'owner' });
    expect((await getUserByEmail(db, 'mufti@example.com'))?.role).toBe('owner');
    expect(await countUsers(db)).toBe(1);
    await expect(createUser(db, { email: 'mufti@example.com', passwordHash: 'y', role: 'editor' })).rejects.toThrow();
    await expect(createUser(db, { email: 'z@example.com', passwordHash: 'y', role: 'admin' as any })).rejects.toThrow();
  });

  it('updates selected user fields', async () => {
    const u = await createUser(db, { email: 'a@example.com', passwordHash: 'x', role: 'reviewer' });
    await updateUser(db, u.id, { role: 'editor', totp_enabled: true, totp_secret: 'ABC' });
    const after = await getUserByEmail(db, 'a@example.com');
    expect([after?.role, after?.totp_enabled, after?.totp_secret]).toEqual(['editor', true, 'ABC']);
  });

  it('counts failures since the last success', async () => {
    for (let i = 0; i < 3; i++) await recordLoginAttempt(db, 'a@example.com', false);
    expect(await recentFailures(db, 'A@example.com')).toBe(3);
    await recordLoginAttempt(db, 'a@example.com', true);
    expect(await recentFailures(db, 'a@example.com')).toBe(0);
    await recordLoginAttempt(db, 'a@example.com', false);
    expect(await recentFailures(db, 'a@example.com')).toBe(1);
  });
});

describe('audit log', () => {
  it('stores and lists newest first', async () => {
    await logAudit(db, { userEmail: 'a@example.com', action: 'tenant.add', target: 'acme', detail: { by: 'form' } });
    await logAudit(db, { userEmail: 'a@example.com', action: 'tenant.pause', target: 'acme' });
    const entries = await listAudit(db);
    expect(entries.map((e) => e.action)).toEqual(['tenant.pause', 'tenant.add']);
    expect(entries[1]!.detail).toEqual({ by: 'form' });
  });
});

describe('runs', () => {
  it('tracks a run from start to finish', async () => {
    const id = await startRun(db, { tenantId: 'acme', kind: 'agent', trigger: 'manual' });
    expect((await getRun(db, id))?.status).toBe('running');
    await updateRun(db, id, {
      status: 'success',
      topic: 'How do I...?',
      steps: [{ name: 'research', status: 'ok', ms: 1200 }],
      checks: [{ name: 'banned-claims', passed: true }],
      sources: [{ url: 'https://example.com', title: 'Example' }],
      costUsd: 0.42,
      tokensIn: 1000,
      tokensOut: 500,
      finished: true,
    });
    const run = (await getRun(db, id))!;
    expect(run.status).toBe('success');
    expect(run.finished_at).not.toBeNull();
    expect(run.steps[0]!.name).toBe('research');
    expect(run.cost_usd).toBeCloseTo(0.42);
  });

  it('filters, and returns the latest run per tenant', async () => {
    const a1 = await startRun(db, { tenantId: 'a', kind: 'agent' });
    await updateRun(db, a1, { status: 'failed', finished: true });
    const a2 = await startRun(db, { tenantId: 'a', kind: 'agent' });
    await updateRun(db, a2, { status: 'success', finished: true });
    await startRun(db, { tenantId: 'b', kind: 'tracker' });
    expect((await listRuns(db, { tenantId: 'a' })).length).toBe(2);
    expect((await listRuns(db, { status: 'failed' })).length).toBe(1);
    const last = await lastRunPerTenant(db, 'agent');
    expect(Object.keys(last)).toEqual(['a']);
    expect(last.a!.id).toBe(a2);
  });

  it('summarises the last seven days per tenant', async () => {
    const ok = await startRun(db, { tenantId: 'a', kind: 'agent' });
    await updateRun(db, ok, { status: 'success', articleUrl: 'https://a.test/blog/x/', finished: true });
    const bad = await startRun(db, { tenantId: 'a', kind: 'agent' });
    await updateRun(db, bad, { status: 'failed', finished: true });
    const held = await startRun(db, { tenantId: 'b', kind: 'agent' });
    await updateRun(db, held, { status: 'held', finished: true });
    const old = await startRun(db, { tenantId: 'b', kind: 'agent' });
    await updateRun(db, old, { status: 'failed' });
    await db.query(`update runs set started_at = now() - interval '9 days' where id = $1`, [old]);
    expect(await weeklyRunStats(db)).toEqual({ a: { published: 1, failed: 1, held: 0 }, b: { published: 0, failed: 0, held: 1 } });
  });

  it('fails runs that never finished', async () => {
    const id = await startRun(db, { tenantId: 'a', kind: 'agent' });
    await db.query(`update runs set started_at = now() - interval '3 hours' where id = $1`, [id]);
    const fresh = await startRun(db, { tenantId: 'a', kind: 'agent' });
    expect(await markStaleRuns(db, 90)).toBe(1);
    expect((await getRun(db, id))?.status).toBe('failed');
    expect((await getRun(db, fresh))?.status).toBe('running');
  });
});

describe('usage and settings', () => {
  it('sums spend per tenant and month', async () => {
    await addUsage(db, { tenantId: 'a', provider: 'anthropic', costUsd: 1.25 });
    await addUsage(db, { tenantId: 'a', provider: 'search', costUsd: 0.25 });
    await addUsage(db, { tenantId: 'b', provider: 'anthropic', costUsd: 3 });
    await db.query(`insert into usage_events (tenant_id, provider, cost_usd, at) values ('a', 'anthropic', 100, '2020-01-15')`);
    const month = new Date().toISOString().slice(0, 7);
    expect(await monthlyCost(db, 'a', month)).toBeCloseTo(1.5);
    expect(await monthlyCost(db, 'a', '2020-01')).toBeCloseTo(100);
    expect(await monthlyCost(db, 'nobody', month)).toBe(0);
    expect(await costByTenant(db, month)).toEqual({ a: 1.5, b: 3 });
  });

  it('stores settings with a fallback', async () => {
    expect(await getSetting(db, 'defaults', { budget: 10 })).toEqual({ budget: 10 });
    await setSetting(db, 'defaults', { budget: 25 });
    await setSetting(db, 'defaults', { budget: 30 });
    expect(await getSetting(db, 'defaults', {})).toEqual({ budget: 30 });
  });
});
