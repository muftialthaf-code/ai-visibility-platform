import { addNotification, claimReminder, markEmailed, type Db } from '@avp/db';
import type { GitHubClient } from '@avp/github';
import type { NotificationSettings } from '@avp/runtime';
import { LABEL, decodeReview } from './review.ts';

export interface NotifyDeps {
  db: Db;
  settings: NotificationSettings;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Save a notification for the dashboard and, if email is set up, send it. An email failure is recorded, never thrown. */
export async function notify(deps: NotifyDeps, n: { tenantId?: string; kind: string; subject: string; body?: string; prNumber?: number }): Promise<void> {
  const id = await addNotification(deps.db, n);
  const key = deps.env.RESEND_API_KEY;
  const from = deps.env.NOTIFY_FROM;
  if (!deps.settings.emails.length) return;
  if (!key || !from) {
    await markEmailed(deps.db, id, 'Email is not set up (RESEND_API_KEY and NOTIFY_FROM are missing).');
    return;
  }
  try {
    const res = await (deps.fetch ?? fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: deps.settings.emails, subject: n.subject, html: `<p>${esc(n.subject)}</p>${n.body ? `<pre style="white-space:pre-wrap">${esc(n.body)}</pre>` : ''}` }),
    });
    await markEmailed(deps.db, id, res.ok ? undefined : `Email service answered ${res.status}`);
  } catch (e) {
    await markEmailed(deps.db, id, e instanceof Error ? e.message : String(e));
  }
}

/** Remind about drafts that have waited longer than the configured time. One reminder per draft per interval. */
export async function remindStaleDrafts(deps: NotifyDeps & { gh: GitHubClient; now?: Date }): Promise<number> {
  const hours = deps.settings.reminderAfterHours;
  if (hours <= 0) return 0;
  const now = (deps.now ?? new Date()).getTime();
  let sent = 0;
  for (const pr of await deps.gh.listPulls({ label: LABEL.article })) {
    if (pr.labels.includes(LABEL.changes)) continue;
    if (now - new Date(pr.createdAt).getTime() < hours * 3600_000) continue;
    const data = decodeReview(pr.body);
    if (!data) continue;
    if (!(await claimReminder(deps.db, data.tenantId, pr.number, hours))) continue;
    await notify(deps, { tenantId: data.tenantId, kind: 'reminder', subject: `Draft waiting for review: ${data.topic.topic}`, body: pr.url, prNumber: pr.number });
    sent++;
  }
  return sent;
}
