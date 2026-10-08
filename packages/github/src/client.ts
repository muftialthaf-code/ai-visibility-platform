import { Octokit } from '@octokit/rest';
import type { FileChange, HistoryEntry } from '@avp/tenant-ops';

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  /** Branch holding production content. */
  branch?: string;
  /** For tests and the local fake server. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface PullSummary {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  merged: boolean;
  draft: boolean;
  branch: string;
  base: string;
  labels: string[];
  author: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  mergeable: boolean | null;
}

export interface PullFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface WorkflowRunSummary {
  id: number;
  status: string | null;
  conclusion: string | null;
  url: string;
  createdAt: string;
  event: string;
}

/** The slice of the GitHub API the platform uses, over a typed client. */
export class GitHubClient {
  readonly octokit: Octokit;
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;

  constructor(cfg: GitHubConfig) {
    this.owner = cfg.owner;
    this.repo = cfg.repo;
    this.branch = cfg.branch ?? 'main';
    this.octokit = new Octokit({
      auth: cfg.token,
      baseUrl: cfg.baseUrl,
      request: cfg.fetch ? { fetch: cfg.fetch } : undefined,
    });
  }

  private get r() {
    return { owner: this.owner, repo: this.repo };
  }

  /* ---------- files ---------- */

  async getFile(path: string, ref = this.branch): Promise<{ content: string; sha: string } | null> {
    try {
      const res = await this.octokit.repos.getContent({ ...this.r, path, ref });
      const data = res.data;
      if (Array.isArray(data) || data.type !== 'file') return null;
      return { content: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
    } catch (e: any) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async listFiles(prefix: string, ref = this.branch): Promise<string[]> {
    const head = await this.octokit.git.getRef({ ...this.r, ref: `heads/${ref}` });
    const commit = await this.octokit.git.getCommit({ ...this.r, commit_sha: head.data.object.sha });
    const tree = await this.octokit.git.getTree({ ...this.r, tree_sha: commit.data.tree.sha, recursive: 'true' });
    if (tree.data.truncated) throw new Error('Repository tree is too large to list in one call');
    return tree.data.tree.filter((t) => t.type === 'blob' && t.path?.startsWith(prefix)).map((t) => t.path!).sort();
  }

  /** Apply all changes as a single commit on a branch (default: the production branch). Returns the commit sha. */
  async commitFiles(changes: FileChange[], message: string, branch = this.branch): Promise<string> {
    if (changes.length === 0) throw new Error('No changes to commit');
    const head = await this.octokit.git.getRef({ ...this.r, ref: `heads/${branch}` });
    const parentSha = head.data.object.sha;
    const parent = await this.octokit.git.getCommit({ ...this.r, commit_sha: parentSha });

    const entries = [];
    for (const c of changes) {
      if (c.content === null) {
        entries.push({ path: c.path, mode: '100644' as const, type: 'blob' as const, sha: null });
      } else {
        const blob = await this.octokit.git.createBlob({ ...this.r, content: c.content, encoding: 'utf-8' });
        entries.push({ path: c.path, mode: '100644' as const, type: 'blob' as const, sha: blob.data.sha });
      }
    }
    const tree = await this.octokit.git.createTree({ ...this.r, base_tree: parent.data.tree.sha, tree: entries });
    const commit = await this.octokit.git.createCommit({ ...this.r, message, tree: tree.data.sha, parents: [parentSha] });
    await this.octokit.git.updateRef({ ...this.r, ref: `heads/${branch}`, sha: commit.data.sha });
    return commit.data.sha;
  }

  async history(path: string, limit = 20, ref = this.branch): Promise<HistoryEntry[]> {
    const res = await this.octokit.repos.listCommits({ ...this.r, path, sha: ref, per_page: limit });
    return res.data.map((c) => ({
      sha: c.sha,
      message: c.commit.message.split('\n')[0] ?? '',
      author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
      date: c.commit.author?.date ?? '',
    }));
  }

  /* ---------- branches and pull requests ---------- */

  async createBranch(name: string, from = this.branch): Promise<void> {
    const head = await this.octokit.git.getRef({ ...this.r, ref: `heads/${from}` });
    await this.octokit.git.createRef({ ...this.r, ref: `refs/heads/${name}`, sha: head.data.object.sha });
  }

  async branchExists(name: string): Promise<boolean> {
    try {
      await this.octokit.git.getRef({ ...this.r, ref: `heads/${name}` });
      return true;
    } catch (e: any) {
      if (e.status === 404) return false;
      throw e;
    }
  }

  async openPull(opts: { branch: string; title: string; body: string; labels?: string[]; draft?: boolean }): Promise<PullSummary> {
    const res = await this.octokit.pulls.create({ ...this.r, head: opts.branch, base: this.branch, title: opts.title, body: opts.body, draft: opts.draft });
    if (opts.labels?.length) await this.octokit.issues.addLabels({ ...this.r, issue_number: res.data.number, labels: opts.labels });
    return this.getPull(res.data.number);
  }

  private toPull(p: any): PullSummary {
    return {
      number: p.number,
      title: p.title,
      body: p.body ?? '',
      state: p.state,
      merged: Boolean(p.merged || p.merged_at),
      draft: Boolean(p.draft),
      branch: p.head.ref,
      base: p.base.ref,
      labels: (p.labels ?? []).map((l: any) => (typeof l === 'string' ? l : l.name)),
      author: p.user?.login ?? 'unknown',
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      url: p.html_url,
      mergeable: p.mergeable ?? null,
    };
  }

  async getPull(number: number): Promise<PullSummary> {
    return this.toPull((await this.octokit.pulls.get({ ...this.r, pull_number: number })).data);
  }

  /** Open pull requests, optionally only those carrying a label. */
  async listPulls(opts: { label?: string; state?: 'open' | 'closed' | 'all' } = {}): Promise<PullSummary[]> {
    const res = await this.octokit.paginate(this.octokit.pulls.list, { ...this.r, state: opts.state ?? 'open', per_page: 100 });
    const pulls = res.map((p) => this.toPull(p));
    return opts.label ? pulls.filter((p) => p.labels.includes(opts.label!)) : pulls;
  }

  async pullFiles(number: number): Promise<PullFile[]> {
    const res = await this.octokit.paginate(this.octokit.pulls.listFiles, { ...this.r, pull_number: number, per_page: 100 });
    return res.map((f) => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions }));
  }

  async mergePull(number: number, title?: string): Promise<string> {
    const res = await this.octokit.pulls.merge({ ...this.r, pull_number: number, merge_method: 'squash', commit_title: title });
    return res.data.sha;
  }

  async updatePull(number: number, patch: { title?: string; body?: string }): Promise<void> {
    await this.octokit.pulls.update({ ...this.r, pull_number: number, ...patch });
  }

  async closePull(number: number, comment?: string): Promise<void> {
    if (comment) await this.comment(number, comment);
    await this.octokit.pulls.update({ ...this.r, pull_number: number, state: 'closed' });
  }

  async comment(number: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({ ...this.r, issue_number: number, body });
  }

  async comments(number: number): Promise<Array<{ id: number; author: string; body: string; createdAt: string }>> {
    const res = await this.octokit.paginate(this.octokit.issues.listComments, { ...this.r, issue_number: number, per_page: 100 });
    return res.map((c) => ({ id: c.id, author: c.user?.login ?? 'unknown', body: c.body ?? '', createdAt: c.created_at }));
  }

  async setLabels(number: number, labels: string[]): Promise<void> {
    await this.octokit.issues.setLabels({ ...this.r, issue_number: number, labels });
  }

  /* ---------- workflows ---------- */

  async dispatchWorkflow(workflowFile: string, inputs: Record<string, string> = {}, ref = this.branch): Promise<void> {
    await this.octokit.actions.createWorkflowDispatch({ ...this.r, workflow_id: workflowFile, ref, inputs });
  }

  async workflowRuns(workflowFile: string, limit = 10): Promise<WorkflowRunSummary[]> {
    const res = await this.octokit.actions.listWorkflowRuns({ ...this.r, workflow_id: workflowFile, per_page: limit });
    return res.data.workflow_runs.map((r) => ({
      id: r.id,
      status: r.status,
      conclusion: r.conclusion,
      url: r.html_url,
      createdAt: r.created_at,
      event: r.event,
    }));
  }
}
