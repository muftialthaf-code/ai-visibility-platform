import type { FileChange, HistoryEntry, TenantStore } from '@avp/tenant-ops';
import type { GitHubClient } from './client.ts';

/** Tenant store backed by the repository on GitHub. Each write is one commit on the production branch. */
export class GitHubStore implements TenantStore {
  constructor(
    private gh: GitHubClient,
    /** Appended to every commit message, e.g. "Changed-by: mufti@example.com". */
    private trailer?: string,
  ) {}

  async readFile(path: string) {
    return (await this.gh.getFile(path))?.content ?? null;
  }

  listFiles(prefix: string) {
    return this.gh.listFiles(prefix);
  }

  async writeFiles(changes: FileChange[], message: string) {
    await this.gh.commitFiles(changes, this.trailer ? `${message}\n\n${this.trailer}` : message);
  }

  history(path: string, limit?: number): Promise<HistoryEntry[]> {
    return this.gh.history(path, limit);
  }

  async readFileAt(path: string, ref: string) {
    return (await this.gh.getFile(path, ref))?.content ?? null;
  }
}
