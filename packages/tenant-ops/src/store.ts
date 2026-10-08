/**
 * Where tenant files live. The CLI uses the local filesystem, the dashboard uses GitHub.
 * Paths are relative to the repository root, e.g. "tenants/acme/tenant.json".
 */
export interface FileChange {
  path: string;
  /** New content, or null to delete the file. */
  content: string | null;
}

export interface HistoryEntry {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface TenantStore {
  /** File content, or null when it does not exist. */
  readFile(path: string): Promise<string | null>;
  /** Paths of every file under a directory prefix (recursive). */
  listFiles(prefix: string): Promise<string[]>;
  /** Apply all changes together as one commit (or one batch of writes). */
  writeFiles(changes: FileChange[], message: string): Promise<void>;
  /** Commit history for a path, newest first. Optional: not every store keeps history. */
  history?(path: string, limit?: number): Promise<HistoryEntry[]>;
  /** File content at a given commit. Required for rollback. */
  readFileAt?(path: string, ref: string): Promise<string | null>;
}

/** In-memory store for tests. */
export class MemoryStore implements TenantStore {
  files = new Map<string, string>();
  commits: Array<{ message: string; changes: FileChange[] }> = [];

  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.files.set(k, v);
  }

  async readFile(path: string) {
    return this.files.get(path) ?? null;
  }

  async listFiles(prefix: string) {
    return [...this.files.keys()].filter((p) => p.startsWith(prefix)).sort();
  }

  async writeFiles(changes: FileChange[], message: string) {
    for (const c of changes) {
      if (c.content === null) this.files.delete(c.path);
      else this.files.set(c.path, c.content);
    }
    this.commits.push({ message, changes });
  }
}
