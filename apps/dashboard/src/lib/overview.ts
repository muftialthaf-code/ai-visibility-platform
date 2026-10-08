import {
  costByTenant, listRuns, markStaleRuns, weeklyRunStats, lastRunPerTenant, type Run,
} from '@avp/db';
import { listTenants, type TenantSummary } from '@avp/tenant-ops';
import { AGENT_SCHEDULE, nextRun } from '@avp/runtime';
import { config } from './env.ts';
import { getDb, getGitHub, getStore, githubConfigured, safe } from './services.ts';

export interface TenantRow extends TenantSummary {
  lastRun?: Run;
  nextRun: Date | null;
  published: number;
  failed: number;
  held: number;
  pendingReviews: number;
  spend: number;
}

export interface Alert {
  level: 'bad' | 'warn';
  text: string;
  href?: string;
}

export interface Overview {
  tenants: TenantRow[];
  alerts: Alert[];
  spend: number;
  budget: number;
  /** Connection problems, shown as a banner instead of crashing the page. */
  problems: string[];
}

export const currentMonth = (d = new Date()) => d.toISOString().slice(0, 7);

/** Open article pull requests per tenant (label "tenant:<id>"). Empty when GitHub is not connected. */
export async function pendingReviewsByTenant(): Promise<Record<string, number>> {
  if (config.devFs() || !githubConfigured()) return {};
  const pulls = await getGitHub().listPulls({ label: 'article' });
  const out: Record<string, number> = {};
  for (const p of pulls) {
    const tag = p.labels.find((l) => l.startsWith('tenant:'));
    if (tag) out[tag.slice(7)] = (out[tag.slice(7)] ?? 0) + 1;
  }
  return out;
}

export async function loadOverview(): Promise<Overview> {
  const problems: string[] = [];
  const now = new Date();
  const month = currentMonth(now);

  const [summaries, db] = await Promise.all([safe(() => listTenants(getStore())), safe(() => getDb())]);
  if (!summaries.ok) problems.push(`GitHub is not reachable, so businesses cannot be listed: ${summaries.error}`);
  if (!db.ok) problems.push(`The database is not reachable, so run history and costs are unavailable: ${db.error}`);

  let stats: Awaited<ReturnType<typeof weeklyRunStats>> = {};
  let last: Record<string, Run> = {};
  let costs: Record<string, number> = {};
  let recentBad: Run[] = [];
  if (db.ok) {
    const d = db.value;
    const r = await safe(async () => {
      await markStaleRuns(d);
      return Promise.all([weeklyRunStats(d), lastRunPerTenant(d, 'agent'), costByTenant(d, month), listRuns(d, { status: 'failed', limit: 10 })]);
    });
    if (r.ok) [stats, last, costs, recentBad] = r.value;
    else problems.push(`Could not read run history: ${r.error}`);
  }
  const pending = await safe(pendingReviewsByTenant);
  if (!pending.ok) problems.push(`Could not read open article reviews from GitHub: ${pending.error}`);

  const tenants: TenantRow[] = (summaries.ok ? summaries.value : []).map((s) => {
    const live = s.valid && s.status === 'active' && !s.agentPaused && (s.articlesPerDay ?? 0) > 0;
    const st = stats[s.id] ?? { published: 0, failed: 0, held: 0 };
    return {
      ...s,
      lastRun: last[s.id],
      nextRun: live ? nextRun(AGENT_SCHEDULE, now) : null,
      published: st.published,
      failed: st.failed,
      held: st.held,
      pendingReviews: pending.ok ? (pending.value[s.id] ?? 0) : 0,
      spend: costs[s.id] ?? 0,
    };
  });

  const alerts: Alert[] = [];
  for (const t of tenants) {
    if (!t.valid) alerts.push({ level: 'bad', text: `${t.id}: the config is invalid (${t.errors[0]?.message ?? 'see details'})`, href: `/businesses/${t.id}` });
    if (t.failed > 0) alerts.push({ level: 'bad', text: `${t.name ?? t.id}: ${t.failed} failed run(s) this week`, href: `/runs?tenant=${t.id}&status=failed` });
    if (t.held > 0) alerts.push({ level: 'warn', text: `${t.name ?? t.id}: ${t.held} article(s) held by a quality check`, href: `/review?tenant=${t.id}` });
    const budget = t.monthlyBudgetUsd ?? 0;
    if (budget > 0 && t.spend >= budget) alerts.push({ level: 'bad', text: `${t.name ?? t.id}: monthly budget of $${budget} reached, the agent is stopped`, href: `/businesses/${t.id}?tab=controls` });
    else if (budget > 0 && t.spend >= budget * 0.8) alerts.push({ level: 'warn', text: `${t.name ?? t.id}: ${Math.round((t.spend / budget) * 100)}% of the monthly budget used`, href: `/businesses/${t.id}?tab=controls` });
  }
  for (const r of recentBad.filter((r) => r.kind === 'deploy')) {
    alerts.push({ level: 'bad', text: `${r.tenant_id}: deploy failed${r.error ? ` (${r.error})` : ''}`, href: `/runs/${r.id}` });
  }

  return {
    tenants,
    alerts,
    spend: tenants.reduce((a, t) => a + t.spend, 0),
    budget: tenants.reduce((a, t) => a + (t.monthlyBudgetUsd ?? 0), 0),
    problems,
  };
}
