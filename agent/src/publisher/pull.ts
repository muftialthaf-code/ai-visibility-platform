import { articlePath, serializeArticle } from '@avp/content';
import type { FileChange } from '@avp/tenant-ops';
import { labelsFor, renderPullBody } from '../review.ts';
import type { AgentContext, ReviewData, WrittenArticle } from '../types.ts';

export const branchName = (tenantId: string, date: string, slug: string) => `agent/${tenantId}/${date}-${slug}`;

export function articleChanges(tenantId: string, written: WrittenArticle[]): FileChange[] {
  return written.map((w) => ({ path: articlePath(tenantId, w.lang, w.article.slug), content: serializeArticle(w.article) }));
}

export const liveUrls = (ctx: Pick<AgentContext, 'siteUrl' | 'tenant'>, written: Array<Pick<WrittenArticle, 'lang' | 'article'>>) =>
  written.map((w) => `${ctx.siteUrl}${w.lang === ctx.tenant.languages.default ? '' : `/${w.lang}`}/blog/${w.article.slug}/`);

/** Put the articles on a new branch and open a pull request for review. Returns the pull request number and its branch. */
export async function openDraft(ctx: AgentContext, written: WrittenArticle[], review: ReviewData): Promise<{ number: number; branch: string; url: string }> {
  const slug = written[0]!.article.slug;
  const branch = branchName(ctx.tenant.id, ctx.now().toISOString().slice(0, 10), slug);
  if (await ctx.gh.branchExists(branch)) throw new Error(`The branch ${branch} already exists, so this article was probably started already.`);
  await ctx.gh.createBranch(branch);
  await ctx.gh.commitFiles(articleChanges(ctx.tenant.id, written), `Draft article: ${written[0]!.article.title}`, branch);
  const pr = await ctx.gh.openPull({
    branch,
    title: `[${ctx.tenant.id}] ${written[0]!.article.title}`,
    body: renderPullBody(review, liveUrls(ctx, written)),
    labels: labelsFor(review),
  });
  return { number: pr.number, branch, url: pr.url };
}

/** Publish: merging the pull request puts the article on the production branch, which the deploy workflow ships. */
export async function mergeDraft(ctx: Pick<AgentContext, 'gh'>, prNumber: number, title?: string): Promise<string> {
  return ctx.gh.mergePull(prNumber, title);
}
