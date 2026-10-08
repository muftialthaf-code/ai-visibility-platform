import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';

/**
 * An in-memory stand-in for the parts of the GitHub REST API the platform uses.
 * It speaks HTTP-shaped requests, so the real Octokit client runs against it unchanged.
 * Used by tests and by the local end-to-end setup. It is a model of the API, not GitHub itself:
 * behaviour that only real GitHub has (rate limits, merge conflicts, permissions) is not simulated.
 */

interface Commit {
  sha: string;
  tree: string;
  parents: string[];
  message: string;
  author: string;
  date: string;
}

interface Pull {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  merged: boolean;
  draft: boolean;
  head: string;
  base: string;
  baseSha: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
}

interface Reply {
  status: number;
  body?: unknown;
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');
const notFound = (): Reply => ({ status: 404, body: { message: 'Not Found' } });

export class FakeGitHub {
  blobs = new Map<string, string>();
  trees = new Map<string, Record<string, string>>();
  commits = new Map<string, Commit>();
  refs = new Map<string, string>();
  pulls: Pull[] = [];
  comments = new Map<number, Array<{ id: number; body: string; createdAt: string }>>();
  dispatches: Array<{ workflow: string; ref: string; inputs: Record<string, string> }> = [];
  workflowRuns = new Map<string, Array<{ id: number; status: string; conclusion: string | null; event: string; created_at: string; html_url: string }>>();
  /** Every request seen, for assertions. */
  requests: Array<{ method: string; path: string }> = [];
  private counter = 0;
  private nextPull = 1;
  private nextComment = 1;

  constructor(
    public owner = 'owner',
    public repo = 'repo',
    seed: Record<string, string> = {},
  ) {
    this.refs.set('heads/main', this.makeCommit(this.makeTree(seed), [], 'Initial commit'));
  }

  /* ---------- model helpers ---------- */

  private makeBlob(content: string): string {
    const sha = sha1('blob:' + content);
    this.blobs.set(sha, content);
    return sha;
  }

  private makeTree(files: Record<string, string>): string {
    const entries: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) entries[path] = this.makeBlob(content);
    return this.storeTree(entries);
  }

  private storeTree(entries: Record<string, string>): string {
    const sha = sha1('tree:' + JSON.stringify(Object.entries(entries).sort()));
    this.trees.set(sha, entries);
    return sha;
  }

  private makeCommit(tree: string, parents: string[], message: string): string {
    const sha = sha1(`commit:${tree}:${parents.join(',')}:${message}:${++this.counter}`);
    this.commits.set(sha, { sha, tree, parents, message, author: 'Fake Author', date: new Date(1_700_000_000_000 + this.counter * 1000).toISOString() });
    return sha;
  }

  treeOf(commitSha: string): Record<string, string> {
    return this.trees.get(this.commits.get(commitSha)!.tree) ?? {};
  }

  /** File content on a branch (or commit), for assertions. */
  read(path: string, ref = 'main'): string | null {
    const sha = this.resolve(ref);
    if (!sha) return null;
    const blob = this.treeOf(sha)[path];
    return blob ? this.blobs.get(blob)! : null;
  }

  files(ref = 'main'): string[] {
    const sha = this.resolve(ref);
    return sha ? Object.keys(this.treeOf(sha)).sort() : [];
  }

  private resolve(ref: string): string | undefined {
    return this.refs.get(`heads/${ref}`) ?? (this.commits.has(ref) ? ref : undefined);
  }

  /** Test helper: put a branch with files on top of main. */
  addBranch(name: string, changes: Record<string, string | null>, message = 'Branch commit'): string {
    const mainSha = this.refs.get('heads/main')!;
    const tree = { ...this.treeOf(mainSha) };
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) delete tree[path];
      else tree[path] = this.makeBlob(content);
    }
    const sha = this.makeCommit(this.storeTree(tree), [mainSha], message);
    this.refs.set(`heads/${name}`, sha);
    return sha;
  }

  private prJson(p: Pull) {
    return {
      number: p.number,
      title: p.title,
      body: p.body,
      state: p.state,
      merged: p.merged,
      merged_at: p.merged ? p.updatedAt : null,
      draft: p.draft,
      head: { ref: p.head, sha: this.refs.get(`heads/${p.head}`) },
      base: { ref: p.base },
      labels: p.labels.map((name) => ({ name })),
      user: { login: 'fake-bot' },
      created_at: p.createdAt,
      updated_at: p.updatedAt,
      html_url: `https://github.example/${this.owner}/${this.repo}/pull/${p.number}`,
      mergeable: p.state === 'open' ? true : null,
    };
  }

  private changedByPull(p: Pull): Array<{ path: string; status: 'added' | 'modified' | 'removed' }> {
    const head = this.refs.get(`heads/${p.head}`);
    if (!head) return [];
    const a = this.treeOf(p.baseSha);
    const b = this.treeOf(head);
    const out: Array<{ path: string; status: 'added' | 'modified' | 'removed' }> = [];
    for (const path of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[path] === b[path]) continue;
      out.push({ path, status: !a[path] ? 'added' : !b[path] ? 'removed' : 'modified' });
    }
    return out.sort((x, y) => x.path.localeCompare(y.path));
  }

  /* ---------- HTTP surface ---------- */

  handle(method: string, rawUrl: string, body: any): Reply {
    const url = new URL(rawUrl, 'http://fake.local');
    const m = /^\/repos\/([^/]+)\/([^/]+)\/(.*)$/.exec(url.pathname);
    this.requests.push({ method, path: url.pathname + url.search });
    if (!m) return notFound();
    const p = decodeURIComponent(m[3]!);
    const q = url.searchParams;
    let g: RegExpExecArray | null;

    // git data
    if (method === 'GET' && (g = /^git\/ref\/(.+)$/.exec(p))) {
      const sha = this.refs.get(g[1]!);
      return sha ? { status: 200, body: { ref: `refs/${g[1]}`, object: { sha, type: 'commit' } } } : notFound();
    }
    if (method === 'POST' && p === 'git/refs') {
      const ref = String(body.ref).replace(/^refs\//, '');
      if (this.refs.has(ref)) return { status: 422, body: { message: 'Reference already exists' } };
      this.refs.set(ref, body.sha);
      return { status: 201, body: { ref: `refs/${ref}`, object: { sha: body.sha } } };
    }
    if (method === 'PATCH' && (g = /^git\/refs\/(.+)$/.exec(p))) {
      if (!this.refs.has(g[1]!)) return notFound();
      this.refs.set(g[1]!, body.sha);
      return { status: 200, body: { ref: `refs/${g[1]}`, object: { sha: body.sha } } };
    }
    if (method === 'GET' && (g = /^git\/commits\/(.+)$/.exec(p))) {
      const c = this.commits.get(g[1]!);
      return c ? { status: 200, body: { sha: c.sha, message: c.message, tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })), author: { name: c.author, date: c.date } } } : notFound();
    }
    if (method === 'POST' && p === 'git/commits') {
      const sha = this.makeCommit(body.tree, body.parents ?? [], body.message);
      return { status: 201, body: { sha } };
    }
    if (method === 'POST' && p === 'git/blobs') {
      const content = body.encoding === 'base64' ? Buffer.from(body.content, 'base64').toString('utf8') : body.content;
      return { status: 201, body: { sha: this.makeBlob(content) } };
    }
    if (method === 'POST' && p === 'git/trees') {
      const base = body.base_tree ? { ...(this.trees.get(body.base_tree) ?? {}) } : {};
      for (const e of body.tree as Array<{ path: string; sha: string | null }>) {
        if (e.sha === null) delete base[e.path];
        else base[e.path] = e.sha;
      }
      return { status: 201, body: { sha: this.storeTree(base) } };
    }
    if (method === 'GET' && (g = /^git\/trees\/(.+)$/.exec(p))) {
      const t = this.trees.get(g[1]!);
      if (!t) return notFound();
      return { status: 200, body: { sha: g[1], truncated: false, tree: Object.entries(t).map(([path, sha]) => ({ path, type: 'blob', mode: '100644', sha })) } };
    }

    // contents and history
    if (method === 'GET' && (g = /^contents\/(.+)$/.exec(p))) {
      const sha = this.resolve(q.get('ref') ?? 'main');
      const blob = sha ? this.treeOf(sha)[g[1]!] : undefined;
      if (!blob) return notFound();
      return { status: 200, body: { type: 'file', path: g[1], sha: blob, encoding: 'base64', content: Buffer.from(this.blobs.get(blob)!).toString('base64') } };
    }
    if (method === 'GET' && p === 'commits') {
      const path = q.get('path');
      let sha = this.resolve(q.get('sha') ?? 'main');
      const limit = Number(q.get('per_page') ?? 30);
      const out: unknown[] = [];
      while (sha && out.length < limit) {
        const c = this.commits.get(sha)!;
        const parent = c.parents[0];
        const here = path ? this.treeOf(sha)[path] : 'x';
        const before = path && parent ? this.treeOf(parent)[path] : undefined;
        if (!path || here !== before) {
          out.push({ sha: c.sha, commit: { message: c.message, author: { name: c.author, date: c.date } }, author: { login: 'fake' } });
        }
        sha = parent;
      }
      return { status: 200, body: out };
    }

    // pull requests
    if (method === 'POST' && p === 'pulls') {
      const head = this.refs.get(`heads/${body.head}`);
      if (!head) return { status: 422, body: { message: 'Head branch does not exist' } };
      const now = new Date().toISOString();
      const pr: Pull = {
        number: this.nextPull++,
        title: body.title,
        body: body.body ?? '',
        state: 'open',
        merged: false,
        draft: Boolean(body.draft),
        head: body.head,
        base: body.base,
        baseSha: this.refs.get(`heads/${body.base}`)!,
        labels: [],
        createdAt: now,
        updatedAt: now,
      };
      this.pulls.push(pr);
      return { status: 201, body: this.prJson(pr) };
    }
    if (method === 'GET' && p === 'pulls') {
      const state = q.get('state') ?? 'open';
      return { status: 200, body: this.pulls.filter((x) => state === 'all' || x.state === state).map((x) => this.prJson(x)) };
    }
    if ((g = /^pulls\/(\d+)(?:\/(files|merge))?$/.exec(p))) {
      const pr = this.pulls.find((x) => x.number === Number(g![1]));
      if (!pr) return notFound();
      if (method === 'GET' && !g[2]) return { status: 200, body: this.prJson(pr) };
      if (method === 'PATCH' && !g[2]) {
        if (body.state) pr.state = body.state;
        if (body.title) pr.title = body.title;
        if (body.body !== undefined) pr.body = body.body;
        pr.updatedAt = new Date().toISOString();
        return { status: 200, body: this.prJson(pr) };
      }
      if (method === 'GET' && g[2] === 'files') {
        const head = this.refs.get(`heads/${pr.head}`)!;
        return {
          status: 200,
          body: this.changedByPull(pr).map((c) => {
            const lines = (blob?: string) => (blob ? this.blobs.get(blob)!.split('\n').length : 0);
            const before = lines(this.treeOf(pr.baseSha)[c.path]);
            const after = lines(this.treeOf(head)[c.path]);
            return { filename: c.path, status: c.status, additions: Math.max(after - before, 0), deletions: Math.max(before - after, 0) };
          }),
        };
      }
      if (method === 'PUT' && g[2] === 'merge') {
        if (pr.state !== 'open') return { status: 405, body: { message: 'Pull Request is not mergeable' } };
        const baseSha = this.refs.get(`heads/${pr.base}`)!;
        const tree = { ...this.treeOf(baseSha) };
        const head = this.treeOf(this.refs.get(`heads/${pr.head}`)!);
        for (const c of this.changedByPull(pr)) {
          if (c.status === 'removed') delete tree[c.path];
          else tree[c.path] = head[c.path]!;
        }
        const sha = this.makeCommit(this.storeTree(tree), [baseSha], body?.commit_title ?? pr.title);
        this.refs.set(`heads/${pr.base}`, sha);
        pr.merged = true;
        pr.state = 'closed';
        pr.updatedAt = new Date().toISOString();
        return { status: 200, body: { sha, merged: true } };
      }
    }

    // issue comments and labels
    if ((g = /^issues\/(\d+)\/(comments|labels)$/.exec(p))) {
      const n = Number(g[1]);
      const pr = this.pulls.find((x) => x.number === n);
      if (!pr) return notFound();
      if (g[2] === 'comments') {
        if (method === 'POST') {
          const c = { id: this.nextComment++, body: body.body, createdAt: new Date().toISOString() };
          this.comments.set(n, [...(this.comments.get(n) ?? []), c]);
          return { status: 201, body: { id: c.id, body: c.body } };
        }
        if (method === 'GET') return { status: 200, body: (this.comments.get(n) ?? []).map((c) => ({ id: c.id, body: c.body, created_at: c.createdAt, user: { login: 'fake-bot' } })) };
      } else {
        if (method === 'POST') pr.labels = [...new Set([...pr.labels, ...body.labels])];
        else if (method === 'PUT') pr.labels = [...body.labels];
        else return notFound();
        return { status: 200, body: pr.labels.map((name) => ({ name })) };
      }
    }

    // workflows
    if (method === 'POST' && (g = /^actions\/workflows\/([^/]+)\/dispatches$/.exec(p))) {
      this.dispatches.push({ workflow: g[1]!, ref: body.ref, inputs: body.inputs ?? {} });
      return { status: 204 };
    }
    if (method === 'GET' && (g = /^actions\/workflows\/([^/]+)\/runs$/.exec(p))) {
      const runs = this.workflowRuns.get(g[1]!) ?? [];
      return { status: 200, body: { total_count: runs.length, workflow_runs: runs } };
    }

    return notFound();
  }
}

/** A fetch() that answers from a FakeGitHub. Pass it to GitHubClient as `fetch`. */
export function fakeFetch(fake: FakeGitHub): typeof fetch {
  return (async (input: any, init: any = {}) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : {};
    const r = fake.handle(method, url, body);
    const headers = { 'content-type': 'application/json; charset=utf-8' };
    return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), { status: r.status, headers });
  }) as typeof fetch;
}

/** Serve a FakeGitHub over HTTP for local end-to-end runs. Point GitHubClient `baseUrl` at it. */
export function serveFake(fake: FakeGitHub, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const r = fake.handle(req.method ?? 'GET', req.url ?? '/', raw ? JSON.parse(raw) : {});
      res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(r.status === 204 ? undefined : JSON.stringify(r.body ?? {}));
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
