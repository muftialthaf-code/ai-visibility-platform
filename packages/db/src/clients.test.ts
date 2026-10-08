import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addTrackerResult, addUsage, connect, createInvite, decideOnboarding, getOnboarding, inviteIsOpen, listInvites, listOnboarding, migrate, revokeInvite, startRun, submitOnboarding, updateRun, usageStatement, type Db } from './index.ts';

let db: Db;
beforeAll(async () => {
  db = await connect('pglite://memory');
  await migrate(db);
});
afterAll(() => db.close());

const future = () => new Date(Date.now() + 86400_000);

describe('onboarding invites', () => {
  it('accepts one submission per invite, even when two arrive together', async () => {
    await createInvite(db, { tokenHash: 'h1', label: 'Acme', createdBy: 'o', expiresAt: future() });
    expect(await inviteIsOpen(db, 'h1')).toEqual({ label: 'Acme' });
    const [a, b] = await Promise.all([submitOnboarding(db, 'h1', { name: 'A' }), submitOnboarding(db, 'h1', { name: 'B' })]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await inviteIsOpen(db, 'h1')).toBeNull();
    expect(await submitOnboarding(db, 'h1', { name: 'C' })).toBeNull();
  });

  it('rejects unknown, expired and revoked invites', async () => {
    expect(await submitOnboarding(db, 'nope', {})).toBeNull();
    await createInvite(db, { tokenHash: 'old', label: 'Old', createdBy: 'o', expiresAt: new Date(Date.now() - 1000) });
    expect(await inviteIsOpen(db, 'old')).toBeNull();
    await createInvite(db, { tokenHash: 'rev', label: 'Rev', createdBy: 'o', expiresAt: future() });
    const id = (await listInvites(db)).find((i) => i.label === 'Rev')!.id;
    await revokeInvite(db, id);
    expect(await submitOnboarding(db, 'rev', {})).toBeNull();
  });

  it('lets a request be decided once', async () => {
    const [req] = await listOnboarding(db, 'pending');
    expect(req!.data.name).toMatch(/^[AB]$/);
    expect(await decideOnboarding(db, req!.id, { status: 'accepted', by: 'o', tenantId: 'acme' })).toBe(true);
    expect(await decideOnboarding(db, req!.id, { status: 'rejected', by: 'o' })).toBe(false);
    expect((await getOnboarding(db, req!.id))!.status).toBe('accepted');
    expect(await listOnboarding(db, 'pending')).toHaveLength(0);
  });
});

describe('usage statement', () => {
  it('adds up articles, tracker answers and cost per business for the month', async () => {
    const run = await startRun(db, { tenantId: 'bill', kind: 'agent' });
    await updateRun(db, run, { status: 'success', finished: true });
    const held = await startRun(db, { tenantId: 'bill', kind: 'agent' });
    await updateRun(db, held, { status: 'held', finished: true });
    await addUsage(db, { tenantId: 'bill', runId: run, provider: 'anthropic', costUsd: 1.25 });
    await addTrackerResult(db, { tenantId: 'bill', week: '2026-10-05', provider: 'claude', prompt: 'q', mentioned: true, cited: false, position: 1, competitors: [], citations: [] });
    await addTrackerResult(db, { tenantId: 'bill', week: '2026-10-05', provider: 'claude', prompt: 'q2', mentioned: false, cited: false, position: null, competitors: [], citations: [], error: 'x' });
    const month = new Date().toISOString().slice(0, 7);
    const line = (await usageStatement(db, month)).find((l) => l.tenantId === 'bill')!;
    expect(line).toMatchObject({ articlesWritten: 1, articlesHeld: 1, trackerAnswers: 1, costUsd: 1.25 });
    expect(await usageStatement(db, '1999-01')).toEqual([]);
  });
});
