import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateTenant } from '@avp/tenant-schema';
import {
  FsStore,
  MemoryStore,
  TenantOpError,
  activeTenants,
  addTenant,
  deepMerge,
  exportTenant,
  getTenant,
  listTenants,
  removeTenant,
  rollbackTenant,
  runnableTenants,
  setAgentPaused,
  setAllAgentsPaused,
  setStatus,
  tenantHistory,
  updateTenant,
} from './index.ts';

const templateText = readFileSync(fileURLToPath(new URL('../../../tenants/_template/tenant.json', import.meta.url)), 'utf8');
/** Replace the template's placeholder text so a business may be launched. */
const makeReal = (store: MemoryStore, id: string) =>
  updateTenant(store, id, {
    identity: { tagline: { en: 'Real tagline.', ar: 'شعار حقيقي.' } },
    profile: { description: { en: 'Real.', ar: 'حقيقي.' }, audience: { en: 'Real.', ar: 'حقيقي.' }, pricingApproach: null },
    author: { bio: { en: 'Real.', ar: 'حقيقي.' } },
  });

const seeded = () => new MemoryStore({ 'tenants/_template/tenant.json': templateText });

describe('addTenant', () => {
  it('creates a valid, paused tenant from the template with the new name everywhere', async () => {
    const store = seeded();
    const t = await addTenant(store, { id: 'acme-dental', name: 'Acme Dental', domain: 'acme-dental.example' });
    expect(t.status).toBe('paused');
    expect(t.agent.paused).toBe(true);
    expect(t.identity.name).toBe('Acme Dental');
    expect(t.integrations.indexNowKey).toMatch(/^[a-f0-9]{32}$/);
    const raw = store.files.get('tenants/acme-dental/tenant.json')!;
    expect(raw).not.toContain('Example Business');
    expect(t.faq).toEqual([]);
    expect(t.profile.offerings).toEqual([]);
    expect(validateTenant(JSON.parse(raw)).ok).toBe(true);
    expect(store.commits.at(-1)?.message).toBe('Add tenant acme-dental');
  });

  it('reshapes translations to the requested languages', async () => {
    const store = seeded();
    const t = await addTenant(store, { id: 'solo', name: 'Solo', domain: 'solo.example', languages: ['en'] });
    expect(Object.keys(t.identity.tagline)).toEqual(['en']);
    expect(t.languages.supported).toEqual(['en']);
  });

  it('supports a language the template does not have by copying the default text', async () => {
    const store = seeded();
    const t = await addTenant(store, { id: 'fr-biz', name: 'FR', domain: 'fr.example', languages: ['fr', 'en'], defaultLanguage: 'fr' });
    expect(t.identity.tagline.fr).toBe(t.identity.tagline.en);
  });

  it('rejects duplicates, bad ids and bad domains', async () => {
    const store = seeded();
    await addTenant(store, { id: 'one', name: 'One', domain: 'one.example' });
    await expect(addTenant(store, { id: 'one', name: 'One', domain: 'one.example' })).rejects.toThrow(/already exists/);
    await expect(addTenant(store, { id: 'Bad_Id', name: 'X', domain: 'x.example' })).rejects.toThrow(/Invalid id/);
    await expect(addTenant(store, { id: '_sneaky', name: 'X', domain: 'x.example' })).rejects.toThrow(/Invalid id/);
    await expect(addTenant(store, { id: 'two', name: 'Two', domain: 'https://two.example' })).rejects.toThrow(TenantOpError);
  });
});

describe('updateTenant and friends', () => {
  it('merges a patch and validates before writing', async () => {
    const store = seeded();
    await addTenant(store, { id: 'a', name: 'A', domain: 'a.example' });
    const before = store.commits.length;
    const r = await updateTenant(store, 'a', { agent: { articlesPerDay: 3, monthlyBudgetUsd: 25 } });
    expect(r.tenant.agent.articlesPerDay).toBe(3);
    expect(r.tenant.agent.publishMode).toBe('approval');
    expect(store.commits.length).toBe(before + 1);
  });

  it('writes nothing when the change is invalid', async () => {
    const store = seeded();
    await addTenant(store, { id: 'a', name: 'A', domain: 'a.example' });
    const before = store.files.get('tenants/a/tenant.json');
    await expect(updateTenant(store, 'a', { identity: { domain: 'not a domain' } })).rejects.toThrow(/invalid/);
    expect(store.files.get('tenants/a/tenant.json')).toBe(before);
  });

  it('refuses to change the id', async () => {
    const store = seeded();
    await addTenant(store, { id: 'a', name: 'A', domain: 'a.example' });
    await expect(updateTenant(store, 'a', { id: 'b' })).rejects.toThrow(/cannot be changed/);
  });

  it('refuses to launch a business that still has template placeholder text', async () => {
    const store = seeded();
    await addTenant(store, { id: 'a', name: 'A', domain: 'a.example' });
    await expect(setStatus(store, 'a', 'active')).rejects.toThrow(/invalid/);
    expect((await getTenant(store, 'a')).status).toBe('paused');
  });

  it('pause, resume and agent pause flip the right fields', async () => {
    const store = seeded();
    await addTenant(store, { id: 'a', name: 'A', domain: 'a.example' });
    await makeReal(store, 'a');
    await setStatus(store, 'a', 'active');
    await setAgentPaused(store, 'a', false);
    const t = await getTenant(store, 'a');
    expect(t.status).toBe('active');
    expect(t.agent.paused).toBe(false);
    await setStatus(store, 'a', 'paused');
    expect((await getTenant(store, 'a')).status).toBe('paused');
  });

  it('deepMerge: objects merge, arrays replace, null deletes', () => {
    expect(deepMerge({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { b: 9 }, l: [3], c: null })).toEqual({ a: { b: 9, c: 2 }, l: [3] });
    expect(deepMerge({ a: 1, x: 2 }, { x: null })).toEqual({ a: 1 });
  });
});

describe('scheduling helpers', () => {
  it('only runs active tenants whose agent is not paused', async () => {
    const store = seeded();
    for (const id of ['live', 'agent-off', 'paused-site']) await addTenant(store, { id, name: id, domain: `${id}.example` });
    await makeReal(store, 'live');
    await makeReal(store, 'agent-off');
    await setStatus(store, 'live', 'active');
    await setAgentPaused(store, 'live', false);
    await setStatus(store, 'agent-off', 'active');
    expect(await runnableTenants(store)).toEqual(['live']);
    expect(await activeTenants(store)).toEqual(['agent-off', 'live']);
  });

  it('list ignores templates and flags broken tenants instead of throwing', async () => {
    const store = seeded();
    await addTenant(store, { id: 'good', name: 'Good', domain: 'good.example' });
    store.files.set('tenants/broken/tenant.json', '{ not json');
    const list = await listTenants(store);
    expect(list.map((s) => [s.id, s.valid])).toEqual([['broken', false], ['good', true]]);
  });
});

describe('pause all', () => {
  it('flips every tenant in one commit and skips ones already in that state', async () => {
    const store = seeded();
    for (const id of ['a', 'b', 'c']) await addTenant(store, { id, name: id, domain: `${id}.example` });
    await setAgentPaused(store, 'a', false);
    await setAgentPaused(store, 'b', false);
    const before = store.commits.length;
    expect(await setAllAgentsPaused(store, true)).toEqual(['a', 'b']);
    expect(store.commits.length).toBe(before + 1);
    expect((await getTenant(store, 'a')).agent.paused).toBe(true);
    expect(await setAllAgentsPaused(store, true)).toEqual([]);
    expect(store.commits.length).toBe(before + 1);
  });
});

describe('export and remove', () => {
  it('exports every file and removal deletes them all', async () => {
    const store = seeded();
    await addTenant(store, { id: 'gone', name: 'Gone', domain: 'gone.example' });
    store.files.set('tenants/gone/articles/en/x.md', '# hi');
    const bundle = await exportTenant(store, 'gone');
    expect(Object.keys(bundle).sort()).toEqual(['tenants/gone/articles/en/x.md', 'tenants/gone/tenant.json']);
    await removeTenant(store, 'gone');
    expect(await store.listFiles('tenants/gone/')).toEqual([]);
    await expect(removeTenant(store, '_template')).rejects.toThrow(/cannot be removed/);
  });
});

describe('history and rollback (real git)', () => {
  it('rolls a config back to an earlier commit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'avp-ops-'));
    const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    mkdirSync(join(root, 'tenants/_template'), { recursive: true });
    writeFileSync(join(root, 'tenants/_template/tenant.json'), templateText);
    git('add', '-A');
    git('commit', '-q', '-m', 'seed');

    const store = new FsStore(root, { commit: true });
    await addTenant(store, { id: 'a', name: 'A', domain: 'a.example' });
    await updateTenant(store, 'a', { agent: { articlesPerDay: 5 } });
    await updateTenant(store, 'a', { agent: { articlesPerDay: 7 } });

    const history = await tenantHistory(store, 'a');
    expect(history.map((h) => h.message)).toEqual(['Update tenant a', 'Update tenant a', 'Add tenant a']);

    const r = await rollbackTenant(store, 'a', history[1]!.sha);
    expect(r.tenant.agent.articlesPerDay).toBe(5);
    expect((await tenantHistory(store, 'a'))[0]!.message).toMatch(/^Roll back tenant a to /);
    expect(dirname(root)).toBeTruthy();
  });
});
