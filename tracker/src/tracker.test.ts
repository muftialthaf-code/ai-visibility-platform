import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { competitorMentions, connect, migrate, promptResults, saveSearchConsoleWeek, searchConsoleWeeks, weeklyVisibility, listRuns, type Db } from '@avp/db';
import { validateTenant, type TenantConfig } from '@avp/tenant-schema';
import { analyzeAnswer, citesDomain, fetchSearchConsoleWeek, firstMention, openaiProvider, perplexityProvider, runTracker, weekStart, type AnswerProvider } from './index.ts';

const template = JSON.parse(readFileSync(fileURLToPath(new URL('../../tenants/_template/tenant.json', import.meta.url)), 'utf8'));
// The blank template cannot validate as active (its placeholder text blocks launching), so validate it paused and flip the flag.
const tenant = (patch: Record<string, unknown> = {}): TenantConfig => {
  const { status = 'active', ...rest } = patch;
  return { ...validateTenant({ ...template, id: 'acme', status: 'paused', identity: { ...template.identity, name: 'Acme Dental', domain: 'acme-dental.example' }, competitors: [{ name: 'Bright Smile', domain: 'brightsmile.example' }, { name: 'City Clinic' }], trackerPrompts: ['best dentist in Riyadh', 'عيادة أسنان في الرياض'], ...rest }).tenant!, status: status as 'active' | 'paused' };
};

describe('analyzeAnswer', () => {
  const brand = { names: ['Acme Dental'], domain: 'acme-dental.example' };
  const rivals = [{ name: 'Bright Smile', domain: 'brightsmile.example' }, { name: 'City Clinic' }];

  it('finds a mention, its rank among the businesses named, and the rivals named', () => {
    const r = analyzeAnswer('Top picks: Bright Smile is popular. Acme Dental offers family care. City Clinic is cheaper.', [], brand, rivals);
    expect(r).toMatchObject({ mentioned: true, position: 2, competitors: ['Bright Smile', 'City Clinic'] });
    expect(r.snippet).toContain('Acme Dental offers family care.');
  });

  it('is not fooled by a name inside another word, and ignores case', () => {
    expect(firstMention('Acmedentalcare is different', 'Acme Dental')).toBe(-1);
    expect(firstMention('ACME DENTAL is open', 'Acme Dental')).toBe(0);
    expect(firstMention('the cityclinics group', 'City Clinic')).toBe(-1);
  });

  it('counts a mention by domain, and matches Arabic names as text', () => {
    expect(analyzeAnswer('See acme-dental.example for prices.', [], brand, []).mentioned).toBe(true);
    expect(analyzeAnswer('أفضل عيادة هي عيادة النور', [], { names: ['عيادة النور'], domain: 'x.example' }, []).mentioned).toBe(true);
  });

  it('reports not mentioned, with no position', () => {
    expect(analyzeAnswer('Try Bright Smile.', [], brand, rivals)).toMatchObject({ mentioned: false, position: null, snippet: null, competitors: ['Bright Smile'] });
  });

  it('counts a citation only for the exact domain or a subdomain', () => {
    expect(citesDomain(['https://www.acme-dental.example/blog'], 'acme-dental.example')).toBe(true);
    expect(citesDomain(['https://blog.acme-dental.example/x'], 'acme-dental.example')).toBe(true);
    expect(citesDomain(['https://notacme-dental.example/x', 'https://evil.com/?u=acme-dental.example'], 'acme-dental.example')).toBe(false);
  });
});

describe('providers', () => {
  const json = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('reads a Perplexity answer and its citations', async () => {
    const p = perplexityProvider({ apiKey: 'k', usdPerRequest: 0.01, fetch: json({ choices: [{ message: { content: 'Answer' } }], citations: ['https://a.example'] }) });
    expect(await p.ask('q', { language: 'en' })).toEqual({ answer: 'Answer', citations: ['https://a.example'], costUsd: 0.01 });
  });

  it('reads an OpenAI answer and its url citations', async () => {
    const p = openaiProvider({ apiKey: 'k', model: 'm', usdPerRequest: 0.02, fetch: json({ output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: 'Hi', annotations: [{ type: 'url_citation', url: 'https://b.example' }] }] }] }) });
    expect(await p.ask('q', { language: 'en' })).toEqual({ answer: 'Hi', citations: ['https://b.example'], costUsd: 0.02 });
  });

  it('turns an error response into a clear error without leaking the key', async () => {
    const p = perplexityProvider({ apiKey: 'secret-key', usdPerRequest: 0, fetch: json({ error: 'bad' }, 401) });
    await expect(p.ask('q', { language: 'en' })).rejects.toThrow('Perplexity answered 401');
    await expect(p.ask('q', { language: 'en' })).rejects.not.toThrow('secret-key');
  });
});

describe('runTracker', () => {
  let db: Db;
  beforeAll(async () => {
    db = await connect('pglite://memory');
    await migrate(db);
  });
  afterAll(() => db.close());

  const provider = (id: string, answerFor: (prompt: string) => string, cost = 0.01): AnswerProvider => ({
    id,
    label: id,
    ask: async (prompt) => ({ answer: answerFor(prompt), citations: ['https://acme-dental.example/blog/x'], costUsd: cost }),
  });
  const ctx = (providers: AnswerProvider[], extra: Partial<Parameters<typeof runTracker>[0]> = {}) => ({
    tenant: tenant(), db, providers, now: () => new Date('2026-10-08T06:43:00Z'), log: () => {}, maxUsd: 5, maxPrompts: 30, ...extra,
  });

  it('records every answer, the week, and the rates', async () => {
    const notes: string[] = [];
    const r = await runTracker(ctx([provider('claude', (p) => (p.includes('Riyadh') && !p.includes('عيادة') ? 'Acme Dental is good. Bright Smile too.' : 'No idea.')), provider('perplexity', () => 'Bright Smile only.')], { notify: async (n) => void notes.push(n.subject) }), { trigger: 'manual' });
    expect(r).toMatchObject({ status: 'success', asked: 4, mentioned: 1, cited: 4, errors: 0 });
    expect(weekStart(new Date('2026-10-08T06:43:00Z'))).toBe('2026-10-05');
    const rows = await promptResults(db, 'acme', '2026-10-05');
    expect(rows).toHaveLength(4);
    expect(rows.find((x) => x.provider === 'claude' && x.prompt.includes('best'))).toMatchObject({ mentioned: true, position: 1, cited: true });
    expect(await competitorMentions(db, 'acme', '2026-10-05')).toEqual([{ name: 'Bright Smile', count: 3 }]);
    expect(notes[0]).toContain('mentioned in 25%');
    const [run] = await listRuns(db, { tenantId: 'acme', kind: 'tracker' });
    expect(run!.status).toBe('success');
    expect(run!.cost_usd).toBeCloseTo(0.04);
  });

  it('does not repeat a scheduled run in the same week, but allows a manual one', async () => {
    const p = provider('claude', () => 'x');
    expect((await runTracker(ctx([p]), { trigger: 'schedule' })).error).toBe('Already measured this week.');
    expect((await runTracker(ctx([p]), { trigger: 'manual' })).status).toBe('success');
  });

  it('records a failing assistant as an error, not as a miss, and keeps going', async () => {
    const bad: AnswerProvider = { id: 'openai', label: 'x', ask: async () => { throw new Error('rate limited'); } };
    const r = await runTracker(ctx([bad, provider('claude', () => 'Acme Dental')], { now: () => new Date('2026-10-15T06:00:00Z') }), { trigger: 'schedule' });
    expect(r).toMatchObject({ status: 'success', asked: 2, errors: 2, mentioned: 2 });
    const v = await weeklyVisibility(db, 'acme', 52);
    const openai = v.find((x) => x.week === '2026-10-12' && x.provider === 'openai')!;
    expect(openai).toMatchObject({ asked: 0, mentioned: 0, errors: 2 });
  });

  it('fails the run when every question fails, and stops at the cost limit', async () => {
    const bad: AnswerProvider = { id: 'openai', label: 'x', ask: async () => { throw new Error('down'); } };
    const failed = await runTracker(ctx([bad], { now: () => new Date('2026-10-22T06:00:00Z') }), { trigger: 'manual' });
    expect(failed.status).toBe('failed');
    const capped = await runTracker(ctx([provider('claude', () => 'x', 1)], { maxUsd: 1, now: () => new Date('2026-10-29T06:00:00Z') }), { trigger: 'manual' });
    expect(capped.asked).toBe(1);
    expect(capped.error).toContain('limit');
  });

  it('skips a business with no prompts, no assistants, or that is paused', async () => {
    expect((await runTracker(ctx([provider('c', () => '')], { tenant: tenant({ trackerPrompts: [] }) }), { trigger: 'manual' })).error).toContain('no tracked prompts');
    expect((await runTracker(ctx([]), { trigger: 'manual' })).error).toContain('No AI assistant');
    expect((await runTracker(ctx([provider('c', () => '')], { tenant: tenant({ status: 'paused' }) }), { trigger: 'manual' })).error).toContain('not active');
  });
});

describe('Search Console', () => {
  it('signs in with the refresh token and returns weekly totals and top queries', async () => {
    const calls: string[] = [];
    const f = (async (url: string, init: any) => {
      calls.push(String(url));
      if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok' }));
      const body = JSON.parse(init.body);
      expect(init.headers.Authorization).toBe('Bearer tok');
      expect(body.startDate).toBe('2026-10-05');
      expect(body.endDate).toBe('2026-10-11');
      return new Response(JSON.stringify(body.dimensions ? { rows: [{ keys: ['dentist'], clicks: 4.2, impressions: 100, position: 3 }] } : { rows: [{ clicks: 10, impressions: 500, position: 7.26 }] }));
    }) as unknown as typeof fetch;
    const w = await fetchSearchConsoleWeek({ clientId: 'i', clientSecret: 's', refreshToken: 'r' }, 'sc-domain:acme.example', '2026-10-05', f);
    expect(w).toEqual({ clicks: 10, impressions: 500, avg_position: 7.3, top_queries: [{ query: 'dentist', clicks: 4, impressions: 100 }] });
    expect(calls[1]).toContain('sc-domain%3Aacme.example');
  });

  it('stores one row per week and updates it on a repeat', async () => {
    const db = await connect('pglite://memory');
    await migrate(db);
    await saveSearchConsoleWeek(db, { tenantId: 'a', week: '2026-10-05', clicks: 1, impressions: 2, avg_position: 3, top_queries: [] });
    await saveSearchConsoleWeek(db, { tenantId: 'a', week: '2026-10-05', clicks: 9, impressions: 2, avg_position: 3, top_queries: [] });
    const rows = await searchConsoleWeeks(db, 'a', 520);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clicks).toBe(9);
    await db.close();
  });
});
