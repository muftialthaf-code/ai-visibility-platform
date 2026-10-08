import type { Db } from './types.ts';

export interface TrackerResultInput {
  tenantId: string;
  runId?: string | null;
  week: string;
  provider: string;
  prompt: string;
  mentioned: boolean;
  cited: boolean;
  position: number | null;
  competitors: string[];
  citations: string[];
  snippet?: string | null;
  answer?: string | null;
  costUsd?: number;
  error?: string | null;
}

export interface TrackerResult extends Required<Omit<TrackerResultInput, 'tenantId' | 'runId' | 'costUsd'>> {
  id: number;
  tenant_id: string;
  at: string;
  cost_usd: number;
}

export async function addTrackerResult(db: Db, r: TrackerResultInput): Promise<void> {
  await db.query(
    `insert into tracker_results (tenant_id, run_id, week, provider, prompt, mentioned, cited, position, competitors, citations, snippet, answer, cost_usd, error)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [r.tenantId, r.runId ?? null, r.week, r.provider, r.prompt, r.mentioned, r.cited, r.position, JSON.stringify(r.competitors), JSON.stringify(r.citations), r.snippet ?? null, r.answer ?? null, r.costUsd ?? 0, r.error ?? null],
  );
}

export interface WeeklyVisibility {
  week: string;
  provider: string;
  asked: number;
  mentioned: number;
  cited: number;
  errors: number;
}

/** Per week and assistant: how many questions were asked, and in how many the business was mentioned or cited. Errors are not counted as misses. */
export async function weeklyVisibility(db: Db, tenantId: string, weeks = 12): Promise<WeeklyVisibility[]> {
  return db.query<WeeklyVisibility>(
    `select to_char(week, 'YYYY-MM-DD') as week, provider,
            count(*) filter (where error is null)::int as asked,
            count(*) filter (where mentioned)::int as mentioned,
            count(*) filter (where cited)::int as cited,
            count(*) filter (where error is not null)::int as errors
       from tracker_results
      where tenant_id = $1 and week >= (current_date - ($2::int * 7))
      group by week, provider order by week, provider`,
    [tenantId, weeks],
  );
}

export interface PromptRow {
  prompt: string;
  provider: string;
  mentioned: boolean;
  cited: boolean;
  position: number | null;
  competitors: string[];
  snippet: string | null;
  error: string | null;
}

export async function promptResults(db: Db, tenantId: string, week: string): Promise<PromptRow[]> {
  return db.query<PromptRow>(
    `select prompt, provider, mentioned, cited, position, competitors, snippet, error from tracker_results
      where tenant_id = $1 and week = $2 order by prompt, provider`,
    [tenantId, week],
  );
}

export async function latestWeek(db: Db, tenantId: string): Promise<string | null> {
  const rows = await db.query<{ week: string | null }>(`select to_char(max(week), 'YYYY-MM-DD') as week from tracker_results where tenant_id = $1`, [tenantId]);
  return rows[0]?.week ?? null;
}

/** How often each competitor appeared in answers that week. */
export async function competitorMentions(db: Db, tenantId: string, week: string): Promise<Array<{ name: string; count: number }>> {
  return db.query(
    `select c.value as name, count(*)::int as count
       from tracker_results t, jsonb_array_elements_text(t.competitors) as c(value)
      where t.tenant_id = $1 and t.week = $2 group by c.value order by count desc, name`,
    [tenantId, week],
  );
}

export async function recentAnswers(db: Db, tenantId: string, week: string, limit = 20) {
  return db.query<{ prompt: string; provider: string; answer: string | null; mentioned: boolean; citations: string[] }>(
    `select prompt, provider, answer, mentioned, citations from tracker_results where tenant_id = $1 and week = $2 and error is null order by prompt, provider limit $3`,
    [tenantId, week, limit],
  );
}

/** Has a tracker run already produced results for the business this week? */
export async function trackedThisWeek(db: Db, tenantId: string, week: string): Promise<boolean> {
  return (await db.query(`select 1 from tracker_results where tenant_id = $1 and week = $2 and error is null limit 1`, [tenantId, week])).length > 0;
}

export interface SearchConsoleWeek {
  tenant_id: string;
  week: string;
  clicks: number;
  impressions: number;
  avg_position: number | null;
  top_queries: Array<{ query: string; clicks: number; impressions: number }>;
}

export async function saveSearchConsoleWeek(db: Db, w: Omit<SearchConsoleWeek, 'tenant_id'> & { tenantId: string }): Promise<void> {
  await db.query(
    `insert into search_console_weekly (tenant_id, week, clicks, impressions, avg_position, top_queries) values ($1,$2,$3,$4,$5,$6)
     on conflict (tenant_id, week) do update set clicks = excluded.clicks, impressions = excluded.impressions, avg_position = excluded.avg_position, top_queries = excluded.top_queries`,
    [w.tenantId, w.week, w.clicks, w.impressions, w.avg_position, JSON.stringify(w.top_queries)],
  );
}

export async function searchConsoleWeeks(db: Db, tenantId: string, weeks = 12): Promise<SearchConsoleWeek[]> {
  return db.query<SearchConsoleWeek>(
    `select tenant_id, to_char(week,'YYYY-MM-DD') as week, clicks, impressions, avg_position, top_queries from search_console_weekly
      where tenant_id = $1 and week >= (current_date - ($2::int * 7)) order by week`,
    [tenantId, weeks],
  );
}
