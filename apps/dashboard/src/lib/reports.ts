import type { WeeklyVisibility } from '@avp/db';

export interface Point {
  week: string;
  /** Share of answers (0 to 1) that mentioned the business, or null when nothing was asked that week. */
  mentioned: number | null;
  cited: number | null;
  asked: number;
}

const share = (n: number, d: number) => (d > 0 ? n / d : null);

/** One point per week for one assistant, or all assistants together when `provider` is not given. */
export function series(rows: WeeklyVisibility[], provider?: string): Point[] {
  const weeks = [...new Set(rows.map((r) => r.week))].sort();
  return weeks.map((week) => {
    const w = rows.filter((r) => r.week === week && (!provider || r.provider === provider));
    const asked = w.reduce((n, r) => n + r.asked, 0);
    return { week, asked, mentioned: share(w.reduce((n, r) => n + r.mentioned, 0), asked), cited: share(w.reduce((n, r) => n + r.cited, 0), asked) };
  });
}

export const percent = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);

/** Change in percentage points between the last two weeks that have data, or null. */
export function delta(points: Point[], key: 'mentioned' | 'cited' = 'mentioned'): number | null {
  const withData = points.filter((p) => p[key] !== null);
  if (withData.length < 2) return null;
  return Math.round((withData.at(-1)![key]! - withData.at(-2)![key]!) * 100);
}

export function toCsv(rows: Array<Record<string, string | number | boolean | null>>): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]!);
  // Cells that start with = + - @ are prefixed so a spreadsheet does not run them as formulas.
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}
