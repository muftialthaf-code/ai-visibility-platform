import { addReviewEvent, dueScheduled, finishScheduled, type Db } from '@avp/db';
import type { GitHubClient } from '@avp/github';
import { decodeReview } from './review.ts';

/** Merge the drafts whose scheduled time has come. A draft that was closed or already merged is marked done or failed. */
export async function publishDue(deps: { db: Db; gh: GitHubClient; now?: Date; log?: (m: string) => void }): Promise<{ published: number; failed: number }> {
  let published = 0;
  let failed = 0;
  for (const job of await dueScheduled(deps.db, deps.now)) {
    try {
      const pr = await deps.gh.getPull(job.pr_number);
      if (pr.merged) {
        await finishScheduled(deps.db, job.id, 'done');
        continue;
      }
      if (pr.state !== 'open') {
        await finishScheduled(deps.db, job.id, 'cancelled', 'The pull request was closed before its scheduled time.');
        continue;
      }
      const data = decodeReview(pr.body);
      await deps.gh.mergePull(pr.number, pr.title.replace(/^\[[^\]]+\]\s*/, 'Publish: '));
      await finishScheduled(deps.db, job.id, 'done');
      await addReviewEvent(deps.db, { tenantId: job.tenant_id, prNumber: pr.number, action: 'published (scheduled)', actor: 'scheduler', note: data?.topic.topic });
      published++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      deps.log?.(`Could not publish pull request ${job.pr_number}: ${message}`);
      await finishScheduled(deps.db, job.id, 'failed', message);
      failed++;
    }
  }
  return { published, failed };
}
