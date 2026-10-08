/**
 * Schedules are defined once here and mirrored in the workflow cron lines
 * (.github/workflows/agent-daily.yml and tracker-weekly.yml). A test keeps them in sync.
 * All times are UTC.
 */
export interface Schedule {
  minute: number;
  hour: number;
  /** 0 = Sunday. Undefined means every day. */
  dayOfWeek?: number;
}

export const AGENT_SCHEDULE: Schedule = { minute: 17, hour: 5 };
export const TRACKER_SCHEDULE: Schedule = { minute: 43, hour: 6, dayOfWeek: 1 };

export function toCron(s: Schedule): string {
  return `${s.minute} ${s.hour} * * ${s.dayOfWeek ?? '*'}`;
}

/** The next time a schedule fires strictly after `from`. GitHub may start the run a few minutes late. */
export function nextRun(s: Schedule, from: Date): Date {
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), s.hour, s.minute, 0, 0));
  for (let i = 0; i < 8; i++) {
    const matchesDay = s.dayOfWeek === undefined || next.getUTCDay() === s.dayOfWeek;
    if (matchesDay && next.getTime() > from.getTime()) return next;
    next.setUTCDate(next.getUTCDate() + 1);
  }
  throw new Error('unreachable: no matching day within a week');
}
