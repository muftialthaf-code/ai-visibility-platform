import { describe, expect, it } from 'vitest';
import { delta, percent, series, toCsv } from './reports.ts';

const row = (week: string, provider: string, asked: number, mentioned: number, cited = 0) => ({ week, provider, asked, mentioned, cited, errors: 0 });

describe('series', () => {
  const rows = [row('2026-10-05', 'claude', 10, 2), row('2026-10-05', 'openai', 10, 4), row('2026-10-12', 'claude', 10, 5)];
  it('combines assistants per week and can filter to one', () => {
    expect(series(rows).map((p) => p.mentioned)).toEqual([0.3, 0.5]);
    expect(series(rows, 'openai')).toEqual([{ week: '2026-10-05', asked: 10, mentioned: 0.4, cited: 0 }, { week: '2026-10-12', asked: 0, mentioned: null, cited: null }]);
  });
  it('treats a week with nothing asked as no data, not zero', () => {
    expect(series([row('2026-10-05', 'claude', 0, 0)])[0]!.mentioned).toBeNull();
  });
  it('reports the change in percentage points over the last two weeks with data', () => {
    expect(delta(series(rows))).toBe(20);
    expect(delta(series(rows.slice(0, 2)))).toBeNull();
    expect(percent(null)).toBe('n/a');
    expect(percent(0.456)).toBe('46%');
  });
});

describe('toCsv', () => {
  it('quotes commas and quotes, and defuses spreadsheet formulas', () => {
    expect(toCsv([{ a: 'x,y', b: 'say "hi"', c: '=SUM(A1)', d: null, e: true }])).toBe('a,b,c,d,e\n"x,y","say ""hi""",\'=SUM(A1),,true\n');
    expect(toCsv([])).toBe('');
  });
});
