import { connect, migrate, type Db } from '@avp/db';
import { GitHubClient, GitHubStore } from '@avp/github';
import { FsStore, type TenantStore } from '@avp/tenant-ops';
import { config } from './env.ts';

// Cached on globalThis so dev hot reloads do not open a new database each time.
const g = globalThis as unknown as { __avpDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  g.__avpDb ??= (async () => {
    const db = await connect(config.databaseUrl());
    await migrate(db);
    return db;
  })().catch((e) => {
    g.__avpDb = undefined; // allow a retry on the next request
    throw e;
  });
  return g.__avpDb;
}

export function githubConfigured(): boolean {
  const c = config.github();
  return Boolean(c.token && c.owner && c.repo);
}

export function getGitHub(): GitHubClient {
  const c = config.github();
  if (!c.token || !c.owner || !c.repo) {
    throw new Error('GitHub is not connected. Set GITHUB_TOKEN, GITHUB_OWNER and GITHUB_REPO in the dashboard host settings.');
  }
  return new GitHubClient({ token: c.token, owner: c.owner, repo: c.repo, branch: c.branch, baseUrl: c.baseUrl });
}

/** The tenant store for the current deployment. `actorEmail` is recorded in each commit message. */
export function getStore(actorEmail?: string): TenantStore {
  if (config.devFs()) return new FsStore(config.repoRoot(), { commit: false });
  return new GitHubStore(getGitHub(), actorEmail ? `Changed-by: ${actorEmail} (dashboard)` : undefined);
}

/** Run a lookup that may fail because GitHub or the database is down, without crashing the page. */
export async function safe<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
