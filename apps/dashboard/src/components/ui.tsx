import type { ReactNode } from 'react';

export function Badge({ tone = 'off', children }: { tone?: 'ok' | 'warn' | 'bad' | 'off'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export const money = (n: number) => `$${n.toFixed(n >= 100 ? 0 : 2)}`;

/** "5 minutes ago" style text for a timestamp. */
export function ago(date: string | Date, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(date).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** Date and time in UTC, labelled, so it is the same for everyone. */
export function when(date: string | Date): string {
  return new Date(date).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function duration(start: string | Date, end: string | Date | null): string {
  if (!end) return 'running';
  const s = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
