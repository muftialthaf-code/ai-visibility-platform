import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addNotification, addReviewEvent, addTopics, claimReminder, connect, deleteTopic, dueScheduled, finishScheduled, listNotifications,
  listReviewEvents, listScheduled, listTopics, markEmailed, migrate, nextTopic, recentRejections, rejectTopicByTitle, schedulePublish,
  setTopicPriority, setTopicStatus, type Db,
} from './index.ts';

let db: Db;
beforeAll(async () => {
  db = await connect('pglite://memory');
  await migrate(db);
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.exec('truncate topics, notifications, review_events, review_reminders, scheduled_publishes restart identity');
});

describe('topics', () => {
  it('adds topics, ignoring ones whose title already exists in any case or status', async () => {
    expect(await addTopics(db, 'a', [{ topic: 'How do I X?', question: 'q', priority: 5 }, { topic: 'Another', question: 'q', priority: 3 }])).toBe(2);
    expect(await addTopics(db, 'a', [{ topic: 'how do i x?', question: 'q', priority: 9 }, { topic: 'New one', question: 'q', priority: 1 }])).toBe(1);
    expect(await addTopics(db, 'b', [{ topic: 'How do I X?', question: 'q', priority: 1 }])).toBe(1); // other tenants are separate
    expect((await listTopics(db, { tenantId: 'a' })).map((t) => t.topic)).toEqual(['How do I X?', 'Another', 'New one']);
  });

  it('picks approved topics first, then the highest priority suggestion', async () => {
    await addTopics(db, 'a', [{ topic: 'High', question: 'q', priority: 9 }, { topic: 'Low approved', question: 'q', priority: 1 }, { topic: 'Mid', question: 'q', priority: 5 }]);
    expect((await nextTopic(db, 'a'))?.topic).toBe('High');
    const low = (await listTopics(db, { tenantId: 'a' })).find((t) => t.topic === 'Low approved')!;
    await setTopicStatus(db, low.id, 'approved');
    expect((await nextTopic(db, 'a'))?.topic).toBe('Low approved');
    await setTopicStatus(db, low.id, 'used');
    await setTopicPriority(db, (await listTopics(db, { tenantId: 'a' })).find((t) => t.topic === 'Mid')!.id, 20);
    expect((await nextTopic(db, 'a'))?.topic).toBe('Mid');
    expect(await nextTopic(db, 'nobody')).toBeNull();
  });

  it('rejection keeps the reason and feeds the list of recent rejections, even for topics not in the backlog', async () => {
    await addTopics(db, 'a', [{ topic: 'Off topic idea', question: 'q', priority: 1 }]);
    await rejectTopicByTitle(db, 'a', 'off topic idea', 'Not our audience');
    await rejectTopicByTitle(db, 'a', 'Written elsewhere', 'Too promotional');
    expect(await recentRejections(db, 'a')).toEqual(expect.arrayContaining([{ topic: 'Off topic idea', reason: 'Not our audience' }, { topic: 'Written elsewhere', reason: 'Too promotional' }]));
    expect(await nextTopic(db, 'a')).toBeNull();
    const t = (await listTopics(db, { tenantId: 'a' }))[0]!;
    await deleteTopic(db, t.id);
    expect((await listTopics(db, { tenantId: 'a' })).length).toBe(1);
  });
});

describe('notifications, review activity and reminders', () => {
  it('stores notifications and records email outcome', async () => {
    const id = await addNotification(db, { tenantId: 'a', kind: 'draft', subject: 'New draft', prNumber: 4 });
    await markEmailed(db, id);
    const id2 = await addNotification(db, { kind: 'failure', subject: 'Run failed' });
    await markEmailed(db, id2, 'provider said 500');
    const list = await listNotifications(db);
    expect(list.find((n) => n.id === id)?.emailed_at).not.toBeNull();
    expect(list.find((n) => n.id === id2)).toMatchObject({ emailed_at: null, email_error: 'provider said 500' });
  });

  it('logs review events per draft', async () => {
    await addReviewEvent(db, { tenantId: 'a', prNumber: 1, action: 'request-changes', actor: 'me@x.com', note: 'Shorten' });
    await addReviewEvent(db, { tenantId: 'a', prNumber: 2, action: 'approve', actor: 'me@x.com' });
    expect((await listReviewEvents(db, { prNumber: 1 })).map((e) => e.action)).toEqual(['request-changes']);
    expect((await listReviewEvents(db, { tenantId: 'a' })).length).toBe(2);
  });

  it('sends a reminder at most once per interval per draft', async () => {
    expect(await claimReminder(db, 'a', 1, 24)).toBe(true);
    expect(await claimReminder(db, 'a', 1, 24)).toBe(false);
    expect(await claimReminder(db, 'a', 2, 24)).toBe(true);
    await db.query(`update review_reminders set last_sent_at = now() - interval '25 hours' where pr_number = 1`);
    expect(await claimReminder(db, 'a', 1, 24)).toBe(true);
  });
});

describe('scheduled publishes', () => {
  it('finds only due ones, and a new schedule replaces the old one for the same draft', async () => {
    const soon = new Date(Date.now() - 60_000);
    const later = new Date(Date.now() + 3_600_000);
    await schedulePublish(db, { tenantId: 'a', prNumber: 1, publishAt: later, createdBy: 'me' });
    expect(await dueScheduled(db)).toEqual([]);
    await schedulePublish(db, { tenantId: 'a', prNumber: 1, publishAt: soon, createdBy: 'me' });
    const due = await dueScheduled(db);
    expect(due.map((d) => d.pr_number)).toEqual([1]);
    expect((await listScheduled(db, { pendingOnly: true })).length).toBe(1);
    await finishScheduled(db, due[0]!.id, 'done');
    expect(await dueScheduled(db)).toEqual([]);
    expect((await listScheduled(db)).map((s) => s.status).sort()).toEqual(['cancelled', 'done']);
  });
});
