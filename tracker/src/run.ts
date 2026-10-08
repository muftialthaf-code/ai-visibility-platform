import { addTrackerResult, addUsage, startRun, trackedThisWeek, updateRun, weeklyVisibility, type Db } from '@avp/db';
import type { TenantConfig } from '@avp/tenant-schema';
import { analyzeAnswer } from './analyze.ts';
import type { AnswerProvider } from './providers.ts';

export interface TrackerContext {
  tenant: TenantConfig;
  db: Db;
  providers: AnswerProvider[];
  now: () => Date;
  log: (m: string) => void;
  /** Most the tracker may spend on one business in one run, in USD. */
  maxUsd: number;
  /** Most prompts to ask per run. */
  maxPrompts: number;
  notify?: (n: { tenantId: string; kind: string; subject: string; body: string }) => Promise<void>;
}

export interface TrackerRunResult {
  runId?: string;
  status: 'success' | 'failed' | 'skipped';
  asked: number;
  mentioned: number;
  cited: number;
  errors: number;
  costUsd: number;
  error?: string;
}

/** Monday of the week containing the date, as YYYY-MM-DD (UTC). */
export function weekStart(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

const isArabic = (s: string) => (s.match(/\p{Script=Arabic}/gu)?.length ?? 0) > s.length / 4;

/** Ask each tracked question to each assistant and record whether the business showed up. */
export async function runTracker(ctx: TrackerContext, opts: { trigger: 'schedule' | 'manual' | 'retry'; githubRunUrl?: string }): Promise<TrackerRunResult> {
  const t = ctx.tenant;
  const skip = (error: string): TrackerRunResult => ({ status: 'skipped', asked: 0, mentioned: 0, cited: 0, errors: 0, costUsd: 0, error });
  if (t.status !== 'active') return skip('The business is not active.');
  const prompts = t.trackerPrompts.slice(0, ctx.maxPrompts);
  if (prompts.length === 0) return skip('The business has no tracked prompts.');
  if (ctx.providers.length === 0) return skip('No AI assistant is connected (add at least one API key).');
  const week = weekStart(ctx.now());
  if (opts.trigger === 'schedule' && (await trackedThisWeek(ctx.db, t.id, week))) return skip('Already measured this week.');

  const runId = await startRun(ctx.db, { tenantId: t.id, kind: 'tracker', trigger: opts.trigger, githubRunUrl: opts.githubRunUrl });
  const brand = { names: [t.identity.name], domain: t.identity.domain };
  const out: TrackerRunResult = { runId, status: 'success', asked: 0, mentioned: 0, cited: 0, errors: 0, costUsd: 0 };
  let capped = false;

  try {
    for (const prompt of prompts) {
      for (const p of ctx.providers) {
        if (out.costUsd >= ctx.maxUsd) {
          capped = true;
          break;
        }
        try {
          const a = await p.ask(prompt, { language: isArabic(prompt) ? 'ar' : t.languages.default });
          const r = analyzeAnswer(a.answer, a.citations, brand, t.competitors);
          out.costUsd += a.costUsd;
          out.asked++;
          if (r.mentioned) out.mentioned++;
          if (r.cited) out.cited++;
          await addUsage(ctx.db, { tenantId: t.id, runId, provider: `tracker:${p.id}`, costUsd: a.costUsd });
          await addTrackerResult(ctx.db, { tenantId: t.id, runId, week, provider: p.id, prompt, mentioned: r.mentioned, cited: r.cited, position: r.position, competitors: r.competitors, citations: a.citations.slice(0, 20), snippet: r.snippet, answer: a.answer.slice(0, 4000), costUsd: a.costUsd });
        } catch (e) {
          out.errors++;
          const message = e instanceof Error ? e.message : String(e);
          ctx.log(`${p.id}: ${message}`);
          await addTrackerResult(ctx.db, { tenantId: t.id, runId, week, provider: p.id, prompt, mentioned: false, cited: false, position: null, competitors: [], citations: [], error: message.slice(0, 500) });
        }
      }
      if (capped) break;
    }
    if (out.asked === 0) {
      out.status = 'failed';
      out.error = out.errors > 0 ? 'Every question failed. See the run for the errors.' : 'No question was asked.';
    }
    if (capped) out.error = `Stopped at the $${ctx.maxUsd.toFixed(2)} limit for one run; ${prompts.length * ctx.providers.length - out.asked - out.errors} question(s) were not asked.`;
    await updateRun(ctx.db, runId, { status: out.status, error: out.error ?? null, costUsd: out.costUsd, finished: true, steps: [{ name: 'ask', status: out.status === 'failed' ? 'failed' : 'ok', detail: `${out.asked} answers, ${out.errors} errors` }] });
    if (out.status === 'success' && ctx.notify) await ctx.notify(await summary(ctx, week, out)).catch((e) => ctx.log(`Could not send the report: ${e}`));
  } catch (e) {
    out.status = 'failed';
    out.error = e instanceof Error ? e.message : String(e);
    await updateRun(ctx.db, runId, { status: 'failed', error: out.error, costUsd: out.costUsd, finished: true });
  }
  return out;
}

async function summary(ctx: TrackerContext, week: string, r: TrackerRunResult) {
  const rows = await weeklyVisibility(ctx.db, ctx.tenant.id, 2);
  const rate = (w: string) => {
    const x = rows.filter((v) => v.week === w);
    const asked = x.reduce((n, v) => n + v.asked, 0);
    return asked ? x.reduce((n, v) => n + v.mentioned, 0) / asked : null;
  };
  const previous = [...new Set(rows.map((v) => v.week))].filter((w) => w < week).sort().pop();
  const now = rate(week);
  const before = previous ? rate(previous) : null;
  const pct = (n: number | null) => (n === null ? 'n/a' : `${Math.round(n * 100)}%`);
  return {
    tenantId: ctx.tenant.id,
    kind: 'report',
    subject: `${ctx.tenant.identity.name}: mentioned in ${pct(now)} of AI answers this week`,
    body: `Mentioned in ${r.mentioned} of ${r.asked} answers (${pct(now)}${before !== null ? `, was ${pct(before)} last week` : ''}). Cited with a link in ${r.cited}. ${r.errors ? `${r.errors} question(s) failed.` : ''}`.trim(),
  };
}
