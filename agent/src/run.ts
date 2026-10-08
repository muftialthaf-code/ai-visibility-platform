import { addUsage, listRuns, monthlyCost, setTopicStatus, startRun, updateRun, type RunStatus } from '@avp/db';
import { articlePath } from '@avp/content';
import { runDeterministicChecks, gatesPassed, riskScore } from './checks/deterministic.ts';
import { judgeArticle } from './checks/judge.ts';
import { articleLanguages } from './brief.ts';
import { notify, type NotifyDeps } from './notify.ts';
import { pickTopic } from './research/topics.ts';
import { researchTopic } from './research/sources.ts';
import { existingArticles } from './site-content.ts';
import { liveUrls, mergeDraft, openDraft } from './publisher/pull.ts';
import { writeArticle } from './writer/article.ts';
import type { AgentContext, CheckResult, Draft, ReviewData, ResearchPack, TopicChoice, WrittenArticle } from './types.ts';

export interface RunOptions {
  trigger: 'schedule' | 'manual' | 'retry';
  /** Do everything except write to GitHub or change the topic backlog. */
  dryRun?: boolean;
  githubRunUrl?: string;
}

export interface RunResult {
  runId?: string;
  status: RunStatus;
  topic?: string;
  prNumber?: number;
  articleUrl?: string;
  error?: string;
  checks: Array<CheckResult & { lang: string }>;
  written?: WrittenArticle[];
}

type Step = { name: string; status: 'ok' | 'failed' | 'skipped'; ms?: number; detail?: string };

const month = (d: Date) => d.toISOString().slice(0, 7);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What an article's checks add up to. */
async function evaluate(ctx: AgentContext, written: WrittenArticle[], pack: ResearchPack, existingByLang: Map<string, Awaited<ReturnType<typeof existingArticles>>>) {
  const checks: Array<CheckResult & { lang: string }> = [];
  for (const w of written) {
    const det = runDeterministicChecks({
      article: w.article,
      lang: w.lang,
      claims: w.draft.claims,
      pack,
      tenant: ctx.tenant,
      globals: ctx.globals,
      existing: existingByLang.get(w.lang) ?? [],
      siteUrl: ctx.siteUrl,
    });
    const judged = await judgeArticle(ctx, { article: w.article, lang: w.lang, claims: w.draft.claims, pack });
    for (const c of [...det, ...judged]) checks.push({ ...c, lang: w.lang });
  }
  return checks;
}

const feedbackFor = (checks: Array<CheckResult & { lang: string }>, lang: string) =>
  checks.filter((c) => c.lang === lang && !c.passed && c.severity === 'blocker').map((c) => `${c.label}: ${c.reason ?? 'failed'}`);

/** Write one article (one run). Never throws: failures become a failed run. */
async function runOne(ctx: AgentContext, opts: RunOptions): Promise<RunResult> {
  const t = ctx.tenant;
  const steps: Step[] = [];
  const dry = Boolean(opts.dryRun);
  const runId = dry ? undefined : await startRun(ctx.db, { tenantId: t.id, kind: 'agent', trigger: opts.trigger, githubRunUrl: opts.githubRunUrl });
  const meter = ctx.llm.meter;
  meter.configure({
    onRecord: dry ? undefined : (r) => addUsage(ctx.db, { tenantId: t.id, runId, provider: r.provider, model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd }),
  });

  const save = (patch: Parameters<typeof updateRun>[2]) => (runId ? updateRun(ctx.db, runId, patch) : Promise.resolve());
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    try {
      const v = await fn();
      steps.push({ name, status: 'ok', ms: Date.now() - started });
      await save({ steps });
      return v;
    } catch (e) {
      steps.push({ name, status: 'failed', ms: Date.now() - started, detail: errorText(e) });
      await save({ steps });
      throw e;
    }
  };

  let topic: TopicChoice | undefined;
  let topicRowId: string | undefined;
  let checks: Array<CheckResult & { lang: string }> = [];
  let written: WrittenArticle[] | undefined;
  const finish = async (status: RunStatus, extra: Partial<RunResult> & { error?: string } = {}): Promise<RunResult> => {
    await save({ status, steps, error: extra.error ?? null, topic: topic?.topic ?? null, prNumber: extra.prNumber ?? null, articleUrl: extra.articleUrl ?? null, checks: checks.map((c) => ({ name: `${c.lang}:${c.name}`, passed: c.passed, reason: c.reason })), costUsd: meter.costUsd, tokensIn: meter.tokensIn, tokensOut: meter.tokensOut, finished: true });
    return { runId, status, topic: topic?.topic, checks, written, ...extra };
  };

  try {
    const picked = await step('topic', () => pickTopic(ctx));
    if (!picked) return await finish('skipped', { error: 'No topics are available to write about.' });
    topicRowId = picked.id;
    topic = { id: picked.id, topic: picked.topic, question: picked.question, persona: picked.persona ?? undefined, intent: picked.intent ?? undefined };
    await save({ topic: topic.topic });

    const pack = await step('research', () => researchTopic(ctx, topic!));
    if (pack.facts.length < 2 || pack.sources.length < ctx.globals.minSources) {
      if (!dry) await setTopicStatus(ctx.db, picked.id, 'suggested', 'Research found too little to write from');
      return await finish('failed', { error: `Research found ${pack.facts.length} fact(s) from ${pack.sources.length} source(s), which is not enough to write a cited article.` });
    }

    const langs = articleLanguages(t);
    const existingByLang = new Map(await Promise.all(langs.map(async (l) => [l, await existingArticles(ctx.store, t.id, l)] as const)));
    const links = [
      ...t.profile.offerings.map((o) => ({ label: o.name[t.languages.default] ?? o.id, path: `/services/${o.id}/` })),
      ...(existingByLang.get(langs[0]!) ?? []).slice(0, 5).map((a) => ({ label: a.title, path: `/blog/${a.slug}/` })),
    ];

    written = await step('write', async () => {
      const first = await writeArticle(ctx, topic!, pack, { lang: langs[0]!, links });
      const rest = [];
      for (const lang of langs.slice(1)) rest.push(await writeArticle(ctx, topic!, pack, { lang, slug: first.article.slug, links }));
      return [first, ...rest];
    });
    checks = await step('checks', () => evaluate(ctx, written!, pack, existingByLang));

    let revision = 0;
    if (!gatesPassed(checks)) {
      const failing = langs.filter((l) => feedbackFor(checks, l).length > 0);
      ctx.log(`Checks failed for ${failing.join(', ')}. Trying one revision.`);
      written = await step('revise', async () => {
        const next: WrittenArticle[] = [];
        for (const w of written!) {
          const fb = feedbackFor(checks, w.lang);
          next.push(fb.length ? await writeArticle(ctx, topic!, pack, { lang: w.lang, slug: written![0]!.article.slug, links, previous: w.draft as Draft, feedback: fb }) : w);
        }
        return next;
      });
      revision = 1;
      checks = await step('checks again', () => evaluate(ctx, written!, pack, existingByLang));
    }

    const passed = gatesPassed(checks);
    const risk = riskScore(checks);
    const review: ReviewData = {
      version: 1,
      tenantId: t.id,
      topic: topic,
      slug: written[0]!.article.slug,
      languages: langs,
      checks,
      risk,
      gatesPassed: passed,
      sources: pack.sources,
      cost: { usd: Math.round(meter.costUsd * 10000) / 10000, tokensIn: meter.tokensIn, tokensOut: meter.tokensOut },
      runId,
      generatedAt: ctx.now().toISOString(),
      claims: Object.fromEntries(written.map((w) => [w.lang, w.draft.claims])),
      revision,
    };
    if (dry) return await finish(passed ? 'success' : 'held');

    const pr = await step('open pull request', () => openDraft(ctx, written!, review));
    await setTopicStatus(ctx.db, picked.id, 'used', undefined, runId);

    const limit = Math.min(t.agent.autoApproveMaxRisk ?? -1, ctx.globals.autoApproveMaxRisk);
    const autoPublish = passed && (t.agent.publishMode === 'auto' || risk <= limit);
    if (autoPublish) {
      await step('publish', () => mergeDraft(ctx, pr.number, `Publish: ${written![0]!.article.title}`));
      const url = liveUrls(ctx, written)[0];
      await notifyIf(ctx, ctx.notifications.notifyOnNewDraft, { tenantId: t.id, kind: 'published', subject: `Published: ${written[0]!.article.title}`, body: url, prNumber: pr.number });
      return await finish('success', { prNumber: pr.number, articleUrl: url });
    }
    await notifyIf(ctx, ctx.notifications.notifyOnNewDraft, {
      tenantId: t.id,
      kind: passed ? 'draft' : 'held',
      subject: passed ? `New draft to review: ${written[0]!.article.title}` : `Draft held, checks failed: ${written[0]!.article.title}`,
      body: pr.url,
      prNumber: pr.number,
    });
    return await finish(passed ? 'success' : 'held', { prNumber: pr.number });
  } catch (e) {
    const budget = e instanceof Error && e.name === 'BudgetExceededError';
    if (topicRowId && !dry && !written) await setTopicStatus(ctx.db, topicRowId, 'suggested').catch(() => {});
    const result = await finish('failed', { error: errorText(e) });
    await notifyIf(ctx, ctx.notifications.notifyOnFailure, { tenantId: t.id, kind: budget ? 'budget' : 'failure', subject: `${t.identity.name}: article run ${budget ? 'stopped, budget reached' : 'failed'}`, body: errorText(e) });
    return result;
  }
}

async function notifyIf(ctx: AgentContext, on: boolean, n: Parameters<typeof notify>[1]) {
  if (!on) return;
  const deps: NotifyDeps = { db: ctx.db, settings: ctx.notifications, env: ctx.env, fetch: ctx.fetch };
  await notify(deps, n).catch((e) => ctx.log(`Could not send notification: ${errorText(e)}`));
}

/**
 * Run the article agent for one business: up to `articlesPerDay` articles. Scheduled runs are idempotent
 * (articles already written today count against the daily quota) and a run already in progress blocks a new one.
 */
export async function runAgent(ctx: AgentContext, opts: RunOptions): Promise<RunResult[]> {
  const t = ctx.tenant;
  const skip = (error: string): RunResult[] => [{ status: 'skipped', error, checks: [] }];
  if (t.status !== 'active') return skip('The business is not active.');
  if (t.agent.paused) return skip('The agent is paused for this business.');
  if (t.agent.articlesPerDay === 0) return skip('Articles per day is set to 0.');

  const today = ctx.now().toISOString().slice(0, 10);
  const recent = (await listRuns(ctx.db, { tenantId: t.id, kind: 'agent', limit: 50 })).filter((r) => r.started_at.toString().length > 0);
  const active = recent.find((r) => r.status === 'running' && Date.now() - new Date(r.started_at).getTime() < 90 * 60_000);
  if (active && !opts.dryRun) return skip('Another run for this business is still in progress.');
  const doneToday = recent.filter((r) => new Date(r.started_at).toISOString().slice(0, 10) === today && (r.status === 'success' || r.status === 'held')).length;
  const count = opts.trigger === 'schedule' ? t.agent.articlesPerDay - doneToday : 1;
  if (count <= 0) return skip(`Already wrote ${doneToday} article(s) today.`);

  const budget = t.agent.monthlyBudgetUsd;
  const results: RunResult[] = [];
  for (let i = 0; i < count; i++) {
    if (budget > 0) {
      const left = budget - (await monthlyCost(ctx.db, t.id, month(ctx.now())));
      if (left <= 0) {
        results.push(...skip(`The monthly budget of $${budget.toFixed(2)} is used up.`));
        await notifyIf(ctx, ctx.notifications.notifyOnFailure, { tenantId: t.id, kind: 'budget', subject: `${t.identity.name}: monthly budget reached`, body: `Agent runs are paused until next month or until the budget is raised.` });
        break;
      }
      ctx.llm.meter.configure({ limitUsd: left });
    } else ctx.llm.meter.configure({ limitUsd: null });
    const r = await runOne(ctx, opts);
    results.push(r);
    if (r.status === 'failed' || r.status === 'skipped') break;
  }
  return results;
}

export { articlePath };
