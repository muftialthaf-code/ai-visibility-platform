import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { addTenant, getTenant, listTenants, removeTenant, rollbackTenant, tenantHistory, updateTenant } from '@avp/tenant-ops';
import { GitHubClient, GitHubStore } from './index.ts';
import { FakeGitHub, fakeFetch } from './fake.ts';

const template = readFileSync(fileURLToPath(new URL('../../../tenants/_template/tenant.json', import.meta.url)), 'utf8');

let fake: FakeGitHub;
let gh: GitHubClient;
beforeEach(() => {
  fake = new FakeGitHub('me', 'platform', { 'tenants/_template/tenant.json': template, 'README.md': 'hello' });
  gh = new GitHubClient({ token: 't', owner: 'me', repo: 'platform', baseUrl: 'https://api.fake', fetch: fakeFetch(fake) });
});

describe('files and commits', () => {
  it('reads files and lists a prefix', async () => {
    expect((await gh.getFile('README.md'))?.content).toBe('hello');
    expect(await gh.getFile('nope.md')).toBeNull();
    expect(await gh.listFiles('tenants/')).toEqual(['tenants/_template/tenant.json']);
  });

  it('commits several changes, including a delete, as one commit', async () => {
    const before = fake.refs.get('heads/main');
    await gh.commitFiles(
      [
        { path: 'a.txt', content: 'A' },
        { path: 'dir/b.txt', content: 'B' },
        { path: 'README.md', content: null },
      ],
      'Batch change',
    );
    expect(fake.read('a.txt')).toBe('A');
    expect(fake.read('dir/b.txt')).toBe('B');
    expect(fake.read('README.md')).toBeNull();
    const commit = fake.commits.get(fake.refs.get('heads/main')!)!;
    expect(commit.parents).toEqual([before]);
    expect(commit.message).toBe('Batch change');
  });

  it('handles non-ASCII content (Arabic) without corruption', async () => {
    await gh.commitFiles([{ path: 'ar.md', content: 'مرحبا بالعالم ✓' }], 'arabic');
    expect((await gh.getFile('ar.md'))?.content).toBe('مرحبا بالعالم ✓');
  });

  it('lists history for a path, newest first, only commits that touched it', async () => {
    await gh.commitFiles([{ path: 'a.txt', content: '1' }], 'one');
    await gh.commitFiles([{ path: 'other.txt', content: 'x' }], 'unrelated');
    await gh.commitFiles([{ path: 'a.txt', content: '2' }], 'two');
    const h = await gh.history('a.txt');
    expect(h.map((c) => c.message)).toEqual(['two', 'one']);
  });
});

describe('pull request flow', () => {
  const article = 'tenants/acme/articles/en/hello.md';

  it('opens, lists, inspects, and merges a PR into main', async () => {
    await gh.createBranch('agent/acme/hello');
    await gh.commitFiles([{ path: article, content: '# Hello' }], 'Add article', 'agent/acme/hello');
    const pr = await gh.openPull({ branch: 'agent/acme/hello', title: 'Article: Hello', body: 'Body', labels: ['article', 'tenant:acme'] });
    expect(pr.number).toBe(1);
    expect(pr.labels).toEqual(['article', 'tenant:acme']);

    expect((await gh.listPulls({ label: 'article' })).map((p) => p.number)).toEqual([1]);
    expect(await gh.listPulls({ label: 'something-else' })).toEqual([]);
    expect((await gh.pullFiles(1)).map((f) => [f.path, f.status])).toEqual([[article, 'added']]);
    expect((await gh.getFile(article, 'agent/acme/hello'))?.content).toBe('# Hello');
    expect(fake.read(article)).toBeNull();

    await gh.mergePull(1, 'Publish: Hello');
    expect(fake.read(article)).toBe('# Hello');
    const merged = await gh.getPull(1);
    expect([merged.state, merged.merged]).toEqual(['closed', true]);
    expect(await gh.listPulls()).toEqual([]);
  });

  it('merging applies the PR diff on top of newer main commits', async () => {
    await gh.createBranch('b1');
    await gh.commitFiles([{ path: 'p.md', content: 'from pr' }], 'pr work', 'b1');
    await gh.openPull({ branch: 'b1', title: 'PR', body: '' });
    await gh.commitFiles([{ path: 'later.md', content: 'landed meanwhile' }], 'main moved on');
    await gh.mergePull(1);
    expect(fake.read('p.md')).toBe('from pr');
    expect(fake.read('later.md')).toBe('landed meanwhile');
  });

  it('closes with a comment and records comments and labels', async () => {
    await gh.createBranch('b2');
    await gh.commitFiles([{ path: 'x.md', content: 'x' }], 'work', 'b2');
    await gh.openPull({ branch: 'b2', title: 'PR', body: '' });
    await gh.comment(1, 'Please shorten the intro');
    await gh.setLabels(1, ['changes-requested']);
    expect((await gh.comments(1)).map((c) => c.body)).toEqual(['Please shorten the intro']);
    expect((await gh.getPull(1)).labels).toEqual(['changes-requested']);
    await gh.closePull(1, 'Rejected: off topic');
    const closed = await gh.getPull(1);
    expect([closed.state, closed.merged]).toEqual(['closed', false]);
    expect((await gh.comments(1)).at(-1)?.body).toBe('Rejected: off topic');
  });

  it('reports a missing branch and an unmergeable PR as errors', async () => {
    expect(await gh.branchExists('nope')).toBe(false);
    await expect(gh.openPull({ branch: 'nope', title: 't', body: '' })).rejects.toThrow();
    await gh.createBranch('b3');
    await gh.commitFiles([{ path: 'y.md', content: 'y' }], 'w', 'b3');
    await gh.openPull({ branch: 'b3', title: 't', body: '' });
    await gh.closePull(1);
    await expect(gh.mergePull(1)).rejects.toThrow();
  });
});

describe('workflow dispatch', () => {
  it('dispatches with inputs and lists runs', async () => {
    await gh.dispatchWorkflow('agent-daily.yml', { tenant: 'acme' });
    expect(fake.dispatches).toEqual([{ workflow: 'agent-daily.yml', ref: 'main', inputs: { tenant: 'acme' } }]);
    fake.workflowRuns.set('agent-daily.yml', [{ id: 9, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', created_at: '2026-10-08T00:00:00Z', html_url: 'https://x/9' }]);
    expect((await gh.workflowRuns('agent-daily.yml'))[0]).toMatchObject({ id: 9, conclusion: 'success' });
  });
});

describe('tenant operations over GitHub', () => {
  it('adds, updates, lists, rolls back and removes a tenant, each as a commit with a trailer', async () => {
    const store = new GitHubStore(gh, 'Changed-by: mufti@example.com');
    await addTenant(store, { id: 'acme', name: 'Acme', domain: 'acme.example' });
    await updateTenant(store, 'acme', { agent: { articlesPerDay: 4 } });
    await updateTenant(store, 'acme', { agent: { articlesPerDay: 6 } });

    expect((await listTenants(store)).map((s) => [s.id, s.valid, s.articlesPerDay])).toEqual([['acme', true, 6]]);
    const history = await tenantHistory(store, 'acme');
    expect(history.map((h) => h.message)).toEqual(['Update tenant acme', 'Update tenant acme', 'Add tenant acme']);
    expect(fake.commits.get(fake.refs.get('heads/main')!)!.message).toContain('Changed-by: mufti@example.com');

    await rollbackTenant(store, 'acme', history[1]!.sha);
    expect((await getTenant(store, 'acme')).agent.articlesPerDay).toBe(4);

    await removeTenant(store, 'acme');
    expect(await listTenants(store)).toEqual([]);
  });

  it('writes nothing to GitHub when validation fails', async () => {
    const store = new GitHubStore(gh);
    await addTenant(store, { id: 'acme', name: 'Acme', domain: 'acme.example' });
    const head = fake.refs.get('heads/main');
    await expect(updateTenant(store, 'acme', { identity: { domain: 'bad domain' } })).rejects.toThrow();
    expect(fake.refs.get('heads/main')).toBe(head);
  });
});
