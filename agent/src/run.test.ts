import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listNotifications, listRuns, listTopics, monthlyCost, schedulePublish } from '@avp/db';
import { decodeReview, labelsFor, publishDue, reviseDraft, runAgent } from './index.ts';
import { createHarness, demoLlm, type Harness } from './testing/index.ts';

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
    expect(await monthlyCost(h.db, 'acme', '2026-10')).toBeGreaterThan(0);
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
