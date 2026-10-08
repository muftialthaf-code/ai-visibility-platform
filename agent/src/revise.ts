import { parseArticle } from '@avp/content';
import { listReviewEvents, addReviewEvent } from '@avp/db';
import { gatesPassed, riskScore, runDeterministicChecks } from './checks/deterministic.ts';
import { judgeArticle } from './checks/judge.ts';
import { articleChanges, liveUrls } from './publisher/pull.ts';
import { researchPackFromReview } from './pack.ts';
import { existingArticles } from './site-content.ts';
import { LABEL, decodeReview, labelsFor, renderPullBody } from './review.ts';
import { writeArticle } from './writer/article.ts';
import type { AgentContext, CheckResult, ReviewData, WrittenArticle } from './types.ts';

/**
 * Rewrite a draft from a reviewer's comments. The article files on the pull request branch are replaced,
 * the checks run again, and the review block and labels are refreshed. The reviewer's notes go in as feedback.
 */
export async function reviseDraft(ctx: AgentContext, prNumber: number, instructions: string, actor = 'agent'): Promise<ReviewData> {
  const pr = await ctx.gh.getPull(prNumber);
  if (pr.state !== 'open') throw new Error(`Pull request ${prNumber} is not open.`);
  const review = decodeReview(pr.body);
  if (!review) throw new Error(`Pull request ${prNumber} has no review data, so it was not made by the agent.`);
  if (review.tenantId !== ctx.tenant.id) throw new Error(`Pull request ${prNumber} belongs to ${review.tenantId}, not ${ctx.tenant.id}.`);

  const pack = researchPackFromReview(review);
  const previous: WrittenArticle[] = [];
  for (const lang of review.languages) {
    const path = `tenants/${ctx.tenant.id}/articles/${lang}/${review.slug}.md`;
    const file = await ctx.gh.getFile(path, pr.branch);
    if (!file) throw new Error(`Could not find ${path} on the draft branch.`);
    const article = parseArticle(file.content);
    previous.push({ lang, article, draft: { ...article, body: article.body, claims: review.claims?.[lang] ?? [] } });
  }
  const links = ctx.tenant.profile.offerings.map((o) => ({ label: o.name[ctx.tenant.languages.default] ?? o.id, path: `/services/${o.id}/` }));
  const feedback = [`Reviewer's instructions: ${instructions}`];
  const written: WrittenArticle[] = [];
  for (const prev of previous) {
    written.push(await writeArticle(ctx, review.topic, pack, { lang: prev.lang, slug: review.slug, links, previous: prev.draft, feedback }));
  }

  const existing = new Map(await Promise.all(review.languages.map(async (l) => [l, await existingArticles(ctx.store, ctx.tenant.id, l)] as const)));
  const checks: Array<CheckResult & { lang: string }> = [];
  for (const w of written) {
    const det = runDeterministicChecks({ article: w.article, lang: w.lang, claims: w.draft.claims, pack, tenant: ctx.tenant, globals: ctx.globals, existing: existing.get(w.lang) ?? [], siteUrl: ctx.siteUrl });
    const judged = await judgeArticle(ctx, { article: w.article, lang: w.lang, claims: w.draft.claims, pack });
    for (const c of [...det, ...judged]) checks.push({ ...c, lang: w.lang });
  }
  const next: ReviewData = {
    ...review,
    checks,
    risk: riskScore(checks),
    gatesPassed: gatesPassed(checks),
    claims: Object.fromEntries(written.map((w) => [w.lang, w.draft.claims])),
    cost: { usd: Math.round((review.cost.usd + ctx.llm.meter.costUsd) * 10000) / 10000, tokensIn: review.cost.tokensIn + ctx.llm.meter.tokensIn, tokensOut: review.cost.tokensOut + ctx.llm.meter.tokensOut },
    revision: review.revision + 1,
    generatedAt: ctx.now().toISOString(),
  };
  await ctx.gh.commitFiles(articleChanges(ctx.tenant.id, written), `Revise draft (revision ${next.revision}): ${instructions.slice(0, 60)}`, pr.branch);
  await ctx.gh.updatePull(prNumber, { body: renderPullBody(next, liveUrls(ctx, written)) });
  await ctx.gh.setLabels(prNumber, labelsFor(next, pr.labels.filter((l) => !l.startsWith('gates:') && l !== LABEL.changes && l !== LABEL.article && !l.startsWith('tenant:'))));
  await ctx.gh.comment(prNumber, `Revised (revision ${next.revision}). ${next.gatesPassed ? 'All required checks pass.' : 'Some required checks still fail.'}`);
  await addReviewEvent(ctx.db, { tenantId: ctx.tenant.id, prNumber, action: 'revised', actor, note: instructions.slice(0, 500) });
  void listReviewEvents;
  return next;
}
