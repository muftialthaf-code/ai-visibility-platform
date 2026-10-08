import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FileChange, HistoryEntry, TenantStore } from './store.ts';

/** Filesystem-backed store used by the CLI. Commits are left to the caller (or `--commit`). */
export class FsStore implements TenantStore {
  constructor(
    private root: string,
    private opts: { commit?: boolean } = {},
  ) {}

  async readFile(path: string) {
    const file = join(this.root, path);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  }

  async listFiles(prefix: string) {
    const out: string[] = [];
    const walk = (rel: string) => {
      const abs = join(this.root, rel);
      if (!existsSync(abs)) return;
      for (const name of readdirSync(abs)) {
        const childRel = `${rel.replace(/\/$/, '')}/${name}`;
        if (statSync(join(this.root, childRel)).isDirectory()) walk(childRel);
        else out.push(childRel);
      }
    };
    walk(prefix);
    return out.sort();
  }

  async writeFiles(changes: FileChange[], message: string) {
    for (const c of changes) {
      const file = join(this.root, c.path);
      if (c.content === null) {
        rmSync(file, { force: true });
      } else {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, c.content);
      }
    }
    if (this.opts.commit) {
      const paths = changes.map((c) => c.path);
      this.git('add', '-A', '--', ...paths);
      this.git('commit', '-m', message, '--', ...paths);
    }
  }

  async history(path: string, limit = 20): Promise<HistoryEntry[]> {
    const out = this.git('log', `-n${limit}`, '--format=%H%x1f%s%x1f%an%x1f%aI', '--', path);
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, message, author, date] = line.split('\x1f');
        return { sha: sha!, message: message!, author: author!, date: date! };
      });
  }

  async readFileAt(path: string, ref: string) {
    try {
      return this.git('show', `${ref}:${path}`);
    } catch {
      return null;
    }
  }

  private git(...args: string[]): string {
    return execFileSync('git', args, { cwd: this.root, encoding: 'utf8' });
  }
}
