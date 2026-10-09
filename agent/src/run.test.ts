import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listNotifications, listRuns, listTopics, monthlyCost, schedulePublish } from '@avp/db';
import { decodeReview, labelsFor, publishDue, reviseDraft, runAgent } from './index.ts';
import { createHarness, demoLlm, type Harness } from './testing/index.ts';

const MONTH = new Date().toISOString().slice(0, 7);
let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(() => h.db.close());

describe('runAgent', () => {
  it('opens a labelled draft pull request with the review data, and leaves main untouched', async () => {
    const [r] = await runAgent(h.ctx(demoLlm()), { trigger: 'manual' });
    expect(r!.error).toBeUndefined();
    expect(r!.status).toBe('success');
    expect(r!.prNumber).toBe(1);
    const pr = await h.gh.getPull(1);
    expect(pr.labels).toEqual(expect.arrayContaining(['article', 'tenant:acme', 'gates:passed']));
    const review = decodeReview(pr.body)!;
    expect(review.gatesPassed).toBe(true);
    expect(review.sources.length).toBeGreaterThanOrEqual(2);
    expect(review.sources.find((s) => s.url.endsWith('guide-three'))?.title).toContain('(accessed)');
    expect(h.fake.files('main').filter((f) => f.includes('/articles/'))).toEqual([]);
    expect(h.fake.files(pr.branch).filter((f) => f.includes('/articles/'))).toEqual([`tenants/acme/articles/en/${review.slug}.md`]);
  });

  it('records the run, its steps, its cost and a notification', async () => {
    await runAgent(h.ctx(demoLlm()), { trigger: 'manual' });
    const [run] = await listRuns(h.db, { tenantId: 'acme' });
    expect(run!.status).toBe('success');
    expect(run!.steps.map((s) => s.name)).toEqual(['topic', 'research', 'write', 'checks', 'open pull request']);
    expect(run!.cost_usd).toBeGreaterThan(0);
    expect(await monthlyCost(h.db, 'acme', MONTH)).toBeGreaterThan(0);
    expect((await listNotifications(h.db)).map((n) => n.kind)).toContain('draft');
    expect((await listTopics(h.db, { tenantId: 'acme', status: 'used' })).length).toBe(1);
  });

  it('publishes straight away in auto mode when every check passes', async () => {
    await (await import('@avp/tenant-ops')).updateTenant(h.store, 'acme', { agent: { publishMode: 'auto' } });
    const tenant = await h.reload();
    const [r] = await runAgent({ ...h.ctx(demoLlm()), tenant }, { trigger: 'manual' });
    expect(r!.status).toBe('success');
    expect(r!.articleUrl).toMatch(/^https:\/\/acme\.example\.com\/blog\//);
    expect(h.fake.files('main').some((f) => f.includes('/articles/en/'))).toBe(true);
  });

  it('auto-approves a low-risk draft in approval mode only when the business allows it', async () => {
    const { updateTenant } = await import('@avp/tenant-ops');
    await updateTenant(h.store, 'acme', { agent: { autoApproveMaxRisk: 30 } });
    const [r] = await runAgent({ ...h.ctx(demoLlm()), tenant: await h.reload() }, { trigger: 'manual' });
    expect(r!.articleUrl).toBeDefined();
  });

  it('retries once when checks fail, and holds the draft if they still fail', async () => {
    const llm = demoLlm({ failClaimsTimes: 99 });
    const [r] = await runAgent(h.ctx(llm), { trigger: 'manual' });
    expect(r!.status).toBe('held');
    expect(llm.calls.filter((c) => c.label.startsWith('write')).length).toBe(2);
    const pr = await h.gh.getPull(r!.prNumber!);
    expect(pr.labels).toContain('gates:failed');
    expect(decodeReview(pr.body)!.revision).toBe(1);
    expect(h.fake.files('main').some((f) => f.includes('/articles/'))).toBe(false);
  });

  it('passes after the one revision when the first attempt failed', async () => {
    const [r] = await runAgent(h.ctx(demoLlm({ failClaimsTimes: 1 })), { trigger: 'manual' });
    expect(r!.status).toBe('success');
    expect(decodeReview((await h.gh.getPull(r!.prNumber!)).body)!.revision).toBe(1);
  });

  it('fails the run, and puts the topic back, when research finds too little', async () => {
    const [r] = await runAgent(h.ctx(demoLlm({ noFacts: true })), { trigger: 'manual' });
    expect(r!.status).toBe('failed');
    expect(r!.error).toContain('not enough');
    expect((await listTopics(h.db, { tenantId: 'acme', status: 'suggested' })).length).toBeGreaterThan(0);
    expect(h.fake.pulls).toHaveLength(0);
  });

  it('writes nothing and records nothing on a dry run', async () => {
    const [r] = await runAgent(h.ctx(demoLlm()), { trigger: 'manual', dryRun: true });
    expect(r!.status).toBe('success');
    expect(r!.written).toHaveLength(1);
    expect(h.fake.pulls).toHaveLength(0);
    expect(await listRuns(h.db, { tenantId: 'acme' })).toHaveLength(0);
  });

  it('does not write more than the daily quota on scheduled runs, even if it is run twice', async () => {
    const ctx = h.ctx(demoLlm());
    expect((await runAgent(ctx, { trigger: 'schedule' }))[0]!.status).toBe('success');
    const again = await runAgent(h.ctx(demoLlm()), { trigger: 'schedule' });
    expect(again[0]!.status).toBe('skipped');
    expect(again[0]!.error).toContain('Already wrote');
    expect(h.fake.pulls).toHaveLength(1);
  });

  it('skips a paused or inactive business, and stops when the monthly budget is used', async () => {
    const { setAgentPaused } = await import('@avp/tenant-ops');
    await setAgentPaused(h.store, 'acme', true);
    expect((await runAgent({ ...h.ctx(demoLlm()), tenant: await h.reload() }, { trigger: 'manual' }))[0]!.error).toContain('paused');
    await setAgentPaused(h.store, 'acme', false);
    const { addUsage } = await import('@avp/db');
    await addUsage(h.db, { tenantId: 'acme', provider: 'anthropic', costUsd: 60 });
    const r = await runAgent({ ...h.ctx(demoLlm()), tenant: await h.reload() }, { trigger: 'manual' });
    expect(r[0]!.status).toBe('skipped');
    expect(r[0]!.error).toContain('budget');
    expect((await listNotifications(h.db)).map((n) => n.kind)).toContain('budget');
  });

  it('does not start while another run is in progress', async () => {
    const { startRun } = await import('@avp/db');
    await startRun(h.db, { tenantId: 'acme', kind: 'agent' });
    expect((await runAgent(h.ctx(demoLlm()), { trigger: 'manual' }))[0]!.error).toContain('in progress');
  });

  it('writes one native article per configured language with a shared slug', async () => {
    const { updateTenant } = await import('@avp/tenant-ops');
    await updateTenant(h.store, 'acme', { agent: { articleLanguages: ['en', 'ar'] } });
    const [r] = await runAgent({ ...h.ctx(demoLlm()), tenant: await h.reload() }, { trigger: 'manual' });
    expect(r!.error).toBeUndefined();
    const review = decodeReview((await h.gh.getPull(r!.prNumber!)).body)!;
    expect(review.languages).toEqual(['en', 'ar']);
    const files = h.fake.files((await h.gh.getPull(r!.prNumber!)).branch).filter((f) => f.includes('/articles/'));
    expect(files).toEqual([`tenants/acme/articles/ar/${review.slug}.md`, `tenants/acme/articles/en/${review.slug}.md`]);
  });
});

describe('review actions', () => {
  it('revises a draft from reviewer instructions, refreshing the review data and labels', async () => {
    const [r] = await runAgent(h.ctx(demoLlm()), { trigger: 'manual' });
    const next = await reviseDraft(h.ctx(demoLlm()), r!.prNumber!, 'Make the tone warmer.');
    expect(next.revision).toBe(1);
    const pr = await h.gh.getPull(r!.prNumber!);
    expect(decodeReview(pr.body)!.revision).toBe(1);
    expect(pr.labels).toEqual(expect.arrayContaining(labelsFor(next)));
    expect((await h.gh.comments(r!.prNumber!)).some((c) => c.body.includes('Revised'))).toBe(true);
  });

  it('refuses to revise a pull request that belongs to another business', async () => {
    const [r] = await runAgent(h.ctx(demoLlm()), { trigger: 'manual' });
    const other = { ...h.ctx(demoLlm()), tenant: { ...h.tenant, id: 'other' } };
    await expect(reviseDraft(other, r!.prNumber!, 'x')).rejects.toThrow('belongs to acme');
  });

  it('publishes scheduled drafts when due, and not before', async () => {
    const [r] = await runAgent(h.ctx(demoLlm()), { trigger: 'manual' });
    await schedulePublish(h.db, { tenantId: 'acme', prNumber: r!.prNumber!, publishAt: new Date('2026-10-09T09:00:00Z'), createdBy: 't' });
    expect(await publishDue({ db: h.db, gh: h.gh, now: new Date('2026-10-08T12:00:00Z') })).toEqual({ published: 0, failed: 0 });
    expect(await publishDue({ db: h.db, gh: h.gh, now: new Date('2026-10-09T09:01:00Z') })).toEqual({ published: 1, failed: 0 });
    expect(h.fake.files('main').some((f) => f.includes('/articles/en/'))).toBe(true);
    expect(await publishDue({ db: h.db, gh: h.gh, now: new Date('2026-10-09T10:00:00Z') })).toEqual({ published: 0, failed: 0 });
  });
});

describe('cost and scale', () => {
  it('warns once a month when a business nears its budget', async () => {
    const { addUsage, usageReport } = await import('@avp/db');
    await addUsage(h.db, { tenantId: 'acme', provider: 'anthropic', costUsd: 41 }); // 82% of the $50 budget
    await runAgent(h.ctx(demoLlm()), { trigger: 'manual' });
    await runAgent(h.ctx(demoLlm()), { trigger: 'manual' });
    expect((await listNotifications(h.db)).filter((n) => n.kind === 'budget-warning')).toHaveLength(1);
    const [row] = await usageReport(h.db, MONTH);
    expect(row!.runs).toBe(2);
    expect(row!.cost_usd).toBeGreaterThan(41);
    expect(row!.run_seconds).toBeGreaterThanOrEqual(0);
  });

  it('keeps stopped runs from blocking a business forever', async () => {
    const { startRun } = await import('@avp/db');
    const id = await startRun(h.db, { tenantId: 'acme', kind: 'agent' });
    await h.db.query(`update runs set started_at = now() - interval '3 hours' where id = $1`, [id]);
    const [r] = await runAgent(h.ctx(demoLlm()), { trigger: 'manual' });
    expect(r!.status).toBe('success');
    expect((await listRuns(h.db, { tenantId: 'acme', status: 'failed' })).length).toBe(1);
  });

  it('runs many businesses at once without collisions: one draft each, on its own branch, with its own cost', async () => {
    const { addTenant, setStatus, updateTenant } = await import('@avp/tenant-ops');
    const { costByTenant } = await import('@avp/db');
    const ids = Array.from({ length: 12 }, (_, i) => `biz-${String.fromCharCode(97 + i)}`);
    for (const id of ids) {
      await addTenant(h.store, { id, name: `Biz ${id}`, domain: `${id}.example.com` });
      await updateTenant(h.store, id, {
        identity: { tagline: { en: 'Demo.', ar: 'تجريبي.' } },
        profile: { description: { en: 'Demo.', ar: 'تجريبي.' }, audience: { en: 'Demo.', ar: 'تجريبي.' }, pricingApproach: null },
        author: { bio: { en: 'Demo.', ar: 'تجريبي.' } },
        agent: { paused: false, articlesPerDay: 1, monthlyBudgetUsd: 50, articleWords: { min: 100, max: 400 } },
      });
      await setStatus(h.store, id, 'active');
    }
    const { getTenant } = await import('@avp/tenant-ops');
    const results = await Promise.all(
      ids.map(async (id) => (await runAgent({ ...h.ctx(demoLlm({ topics: [`How does ${id} work for new customers?`] })), tenant: await getTenant(h.store, id) }, { trigger: 'schedule' }))[0]!),
    );
    expect(results.map((r) => r.error ?? r.status)).toEqual(ids.map(() => 'success'));
    const branches = h.fake.pulls.map((p) => p.head);
    expect(new Set(branches).size).toBe(12);
    expect(branches.every((b) => ids.some((id) => b.startsWith(`agent/${id}/`)))).toBe(true);
    const costs = await costByTenant(h.db, MONTH);
    expect(ids.every((id) => (costs[id] ?? 0) > 0)).toBe(true);
    // Each business's draft touched only its own folder.
    for (const p of h.fake.pulls) {
      const files = (await h.gh.pullFiles(p.number)).map((f) => f.path);
      const id = p.head.split('/')[1]!;
      expect(files.every((f) => f.startsWith(`tenants/${id}/`))).toBe(true);
    }
  }, 120_000);
});

describe('notifications', () => {
  it('records a note and tells the owner when email is not set up', async () => {
    const { notify } = await import('./notify.ts');
    const settings = { ...h.ctx(demoLlm()).notifications, emails: ['o@example.com'] };
    await notify({ db: h.db, settings, env: {} }, { kind: 'failure', subject: 'S' });
    const [n] = await listNotifications(h.db);
    expect(n!.email_error).toContain('not set up');
  });

  it('sends through Resend with the key, and records a failed send without throwing', async () => {
    const { notify } = await import('./notify.ts');
    const settings = { ...h.ctx(demoLlm()).notifications, emails: ['o@example.com'] };
    const seen: any[] = [];
    const ok = (async (url: string, init: any) => (seen.push({ url, init }), new Response('{}', { status: 200 }))) as unknown as typeof fetch;
    await notify({ db: h.db, settings, env: { RESEND_API_KEY: 'k', NOTIFY_FROM: 'a@b.c' }, fetch: ok }, { kind: 'draft', subject: '<b>Hi</b>', body: 'x' });
    expect(seen[0].url).toBe('https://api.resend.com/emails');
    expect(seen[0].init.headers.Authorization).toBe('Bearer k');
    expect(JSON.parse(seen[0].init.body).html).toContain('&lt;b&gt;');
    const bad = (async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
    await notify({ db: h.db, settings, env: { RESEND_API_KEY: 'k', NOTIFY_FROM: 'a@b.c' }, fetch: bad }, { kind: 'draft', subject: 'S2' });
    expect((await listNotifications(h.db))[0]!.email_error).toContain('500');
  });

  it('reminds once per interval about drafts left waiting', async () => {
    const { remindStaleDrafts } = await import('./notify.ts');
    await runAgent(h.ctx(demoLlm()), { trigger: 'manual' });
    const deps = { db: h.db, gh: h.gh, settings: h.ctx(demoLlm()).notifications, env: {} };
    expect(await remindStaleDrafts({ ...deps, now: new Date(Date.now() + 3600_000) })).toBe(0);
    expect(await remindStaleDrafts({ ...deps, now: new Date(Date.now() + 48 * 3600_000) })).toBe(1);
    expect(await remindStaleDrafts({ ...deps, now: new Date(Date.now() + 49 * 3600_000) })).toBe(0);
  });
});
