import type { Db } from './types.ts';

/* ---------- topics ---------- */

export type TopicStatus = 'suggested' | 'approved' | 'rejected' | 'used' | 'duplicate';

export interface Topic {
  id: string;
  tenant_id: string;
  topic: string;
  question: string;
  persona: string | null;
  intent: string | null;
  sources: Array<{ url: string; title?: string }>;
  priority: number;
  status: TopicStatus;
  reason: string | null;
  used_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewTopic {
  topic: string;
  question: string;
  persona?: string;
  intent?: string;
  sources?: Array<{ url: string; title?: string }>;
  priority: number;
}

/** Add topics to a tenant's backlog. A topic whose title already exists (any status) is skipped. Returns how many were new. */
export async function addTopics(db: Db, tenantId: string, topics: NewTopic[]): Promise<number> {
  let added = 0;
  for (const t of topics) {
    const rows = await db.query(
      `insert into topics (tenant_id, topic, question, persona, intent, sources, priority)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict (tenant_id, md5(lower(topic))) do nothing returning id`,
      [tenantId, t.topic, t.question, t.persona ?? null, t.intent ?? null, JSON.stringify(t.sources ?? []), t.priority],
    );
    added += rows.length;
  }
  return added;
}

export async function listTopics(db: Db, opts: { tenantId: string; status?: TopicStatus | TopicStatus[]; limit?: number }): Promise<Topic[]> {
  const statuses = opts.status === undefined ? null : Array.isArray(opts.status) ? opts.status : [opts.status];
  return db.query<Topic>(
    `select * from topics where tenant_id = $1 and ($2::text[] is null or status = any($2::text[]))
     order by (status = 'approved') desc, priority desc, created_at limit $3`,
    [opts.tenantId, statuses, opts.limit ?? 200],
  );
}

/** The next topic to write: approved ones first, then the highest priority suggestion. */
export async function nextTopic(db: Db, tenantId: string): Promise<Topic | null> {
  return (await listTopics(db, { tenantId, status: ['approved', 'suggested'], limit: 1 }))[0] ?? null;
}

export async function setTopicStatus(db: Db, id: string, status: TopicStatus, reason?: string, usedRunId?: string): Promise<void> {
  await db.query(`update topics set status = $2, reason = coalesce($3, reason), used_run_id = coalesce($4, used_run_id), updated_at = now() where id = $1`, [id, status, reason ?? null, usedRunId ?? null]);
}

export async function setTopicPriority(db: Db, id: string, priority: number): Promise<void> {
  await db.query('update topics set priority = $2, updated_at = now() where id = $1', [id, priority]);
}

export async function deleteTopic(db: Db, id: string): Promise<void> {
  await db.query('delete from topics where id = $1', [id]);
}

/** Record that a topic was rejected in review (by its title), creating the row if the topic came from elsewhere. */
export async function rejectTopicByTitle(db: Db, tenantId: string, title: string, reason: string): Promise<void> {
  const rows = await db.query(`update topics set status = 'rejected', reason = $3, updated_at = now() where tenant_id = $1 and lower(topic) = lower($2) returning id`, [tenantId, title, reason]);
  if (rows.length === 0) {
    await db.query(
      `insert into topics (tenant_id, topic, question, status, reason) values ($1, $2, $2, 'rejected', $3) on conflict (tenant_id, md5(lower(topic))) do nothing`,
      [tenantId, title, reason],
    );
  }
}

/** Topics rejected in review, newest first, with the reasons. These steer what the agent proposes next. */
export async function recentRejections(db: Db, tenantId: string, limit = 15): Promise<Array<{ topic: string; reason: string | null }>> {
  return db.query(`select topic, reason from topics where tenant_id = $1 and status = 'rejected' order by updated_at desc limit $2`, [tenantId, limit]);
}

/* ---------- notifications ---------- */

export interface NotificationRow {
  id: number;
  at: string;
  tenant_id: string | null;
  kind: string;
  subject: string;
  body: string;
  pr_number: number | null;
  emailed_at: string | null;
  email_error: string | null;
}

export async function addNotification(db: Db, n: { tenantId?: string; kind: string; subject: string; body?: string; prNumber?: number }): Promise<number> {
  const rows = await db.query<{ id: number }>(
    'insert into notifications (tenant_id, kind, subject, body, pr_number) values ($1, $2, $3, $4, $5) returning id',
    [n.tenantId ?? null, n.kind, n.subject, n.body ?? '', n.prNumber ?? null],
  );
  return rows[0]!.id;
}

export async function markEmailed(db: Db, id: number, error?: string): Promise<void> {
  await db.query('update notifications set emailed_at = case when $2::text is null then now() else null end, email_error = $2 where id = $1', [id, error ?? null]);
}

export async function listNotifications(db: Db, limit = 50): Promise<NotificationRow[]> {
  return db.query<NotificationRow>('select * from notifications order by at desc, id desc limit $1', [limit]);
}

/* ---------- review events and reminders ---------- */

export interface ReviewEvent {
  id: number;
  at: string;
  tenant_id: string;
  pr_number: number;
  action: string;
  actor: string;
  note: string | null;
}

export async function addReviewEvent(db: Db, e: { tenantId: string; prNumber: number; action: string; actor: string; note?: string }): Promise<void> {
  await db.query('insert into review_events (tenant_id, pr_number, action, actor, note) values ($1, $2, $3, $4, $5)', [e.tenantId, e.prNumber, e.action, e.actor, e.note ?? null]);
}

export async function listReviewEvents(db: Db, opts: { tenantId?: string; prNumber?: number; limit?: number } = {}): Promise<ReviewEvent[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.tenantId) where.push(`tenant_id = $${params.push(opts.tenantId)}`);
  if (opts.prNumber) where.push(`pr_number = $${params.push(opts.prNumber)}`);
  params.push(opts.limit ?? 100);
  return db.query<ReviewEvent>(`select * from review_events ${where.length ? 'where ' + where.join(' and ') : ''} order by at desc, id desc limit $${params.length}`, params);
}

/** True when no reminder has gone out for this draft within `everyHours`. Records the reminder when it returns true. */
export async function claimReminder(db: Db, tenantId: string, prNumber: number, everyHours: number): Promise<boolean> {
  const rows = await db.query(
    `insert into review_reminders (tenant_id, pr_number, last_sent_at) values ($1, $2, now())
     on conflict (tenant_id, pr_number) do update set last_sent_at = now()
       where review_reminders.last_sent_at < now() - ($3 || ' hours')::interval
     returning pr_number`,
    [tenantId, prNumber, String(everyHours)],
  );
  return rows.length > 0;
}

/* ---------- scheduled publishes ---------- */

export interface ScheduledPublish {
  id: number;
  tenant_id: string;
  pr_number: number;
  publish_at: string;
  status: 'pending' | 'done' | 'cancelled' | 'failed';
  error: string | null;
  created_by: string;
  created_at: string;
}

/** Schedule a draft to publish at a time. Any earlier pending schedule for the same draft is replaced. */
export async function schedulePublish(db: Db, s: { tenantId: string; prNumber: number; publishAt: Date; createdBy: string }): Promise<number> {
  await db.query(`update scheduled_publishes set status = 'cancelled' where tenant_id = $1 and pr_number = $2 and status = 'pending'`, [s.tenantId, s.prNumber]);
  const rows = await db.query<{ id: number }>(
    'insert into scheduled_publishes (tenant_id, pr_number, publish_at, created_by) values ($1, $2, $3, $4) returning id',
    [s.tenantId, s.prNumber, s.publishAt.toISOString(), s.createdBy],
  );
  return rows[0]!.id;
}

export async function dueScheduled(db: Db, now = new Date()): Promise<ScheduledPublish[]> {
  return db.query<ScheduledPublish>(`select * from scheduled_publishes where status = 'pending' and publish_at <= $1 order by publish_at`, [now.toISOString()]);
}

export async function finishScheduled(db: Db, id: number, status: 'done' | 'failed' | 'cancelled', error?: string): Promise<void> {
  await db.query('update scheduled_publishes set status = $2, error = $3 where id = $1', [id, status, error ?? null]);
}

export async function listScheduled(db: Db, opts: { tenantId?: string; pendingOnly?: boolean } = {}): Promise<ScheduledPublish[]> {
  return db.query<ScheduledPublish>(
    `select * from scheduled_publishes where ($1::text is null or tenant_id = $1) and ($2::boolean = false or status = 'pending') order by publish_at desc limit 200`,
    [opts.tenantId ?? null, opts.pendingOnly ?? false],
  );
}
