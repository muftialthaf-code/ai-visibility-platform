import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connect, migrate, type Db } from '@avp/db';
import { FakeGitHub, fakeFetch } from '@avp/github/fake';
import { GitHubClient, GitHubStore } from '@avp/github';
import { DEFAULT_GLOBALS, DEFAULT_NOTIFICATIONS } from '@avp/runtime';
import type { Llm } from '@avp/llm';
import { addTenant, getTenant, setStatus, updateTenant } from '@avp/tenant-ops';
import type { TenantConfig } from '@avp/tenant-schema';
import type { AgentContext } from '../types.ts';

const template = readFileSync(fileURLToPath(new URL('../../../tenants/_template/tenant.json', import.meta.url)), 'utf8');

export interface Harness {
  db: Db;
  fake: FakeGitHub;
  gh: GitHubClient;
  store: GitHubStore;
  tenant: TenantConfig;
  ctx: (llm: Llm, patch?: Partial<AgentContext>) => AgentContext;
  reload: () => Promise<TenantConfig>;
}

/** An in-memory database and fake GitHub, with one launched business called "acme". Used by tests and the local end-to-end setup. */
export async function createHarness(id = 'acme', tenantPatch: Record<string, unknown> = {}): Promise<Harness> {
  const db = await connect('pglite://memory');
  await migrate(db);
  const fake = new FakeGitHub('me', 'platform', { 'tenants/_template/tenant.json': template });
  const gh = new GitHubClient({ token: 't', owner: 'me', repo: 'platform', baseUrl: 'https://api.fake', fetch: fakeFetch(fake) });
  const store = new GitHubStore(gh);
  await addTenant(store, { id, name: 'Acme Demo Co', domain: 'acme.example.com' });
  await updateTenant(store, id, {
    identity: { tagline: { en: 'Demo tagline.', ar: 'شعار تجريبي.' } },
    profile: { description: { en: 'Demo business.', ar: 'نشاط تجريبي.' }, audience: { en: 'Demo audience.', ar: 'جمهور تجريبي.' }, pricingApproach: null },
    author: { bio: { en: 'Demo bio.', ar: 'سيرة تجريبية.' } },
    voice: { bannedClaims: ['guaranteed results'] },
    agent: { paused: false, articlesPerDay: 1, publishMode: 'approval', monthlyBudgetUsd: 50, articleWords: { min: 100, max: 400 } },
    ...tenantPatch,
  });
  await setStatus(store, id, 'active');
  const reload = () => getTenant(store, id);
  const tenant = await reload();
  return {
    db,
    fake,
    gh,
    store,
    tenant,
    reload,
    ctx: (llm, patch = {}) => ({
      tenant,
      llm,
      db,
      gh,
      store,
      globals: DEFAULT_GLOBALS,
      notifications: { ...DEFAULT_NOTIFICATIONS, emails: [] },
      siteUrl: 'https://acme.example.com',
      now: () => new Date('2026-10-08T05:17:00Z'),
      log: () => {},
      env: {},
      ...patch,
    }),
  };
}
