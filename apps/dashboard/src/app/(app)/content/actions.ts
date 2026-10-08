'use server';
import { addTopics, deleteTopic, listTopics, setTopicPriority, setTopicStatus, type TopicStatus } from '@avp/db';
import type { FormState } from '@/components/ActionForm';
import { audit, requireUser } from '@/lib/auth';
import { getDb } from '@/lib/services';

const text = (d: FormData, k: string) => String(d.get(k) ?? '').trim();

export async function addTopicAction(_prev: FormState, data: FormData): Promise<FormState> {
  const tenant = text(data, 'tenant');
  const user = await requireUser('content:write', tenant);
  const topic = text(data, 'topic');
  if (!tenant || topic.length < 8) return { error: 'Enter a business and a topic of at least 8 characters.' };
  const added = await addTopics(await getDb(), tenant, [{ topic, question: text(data, 'question') || topic, priority: 90 }]);
  if (!added) return { error: 'That topic is already in the list.' };
  // A topic a person adds is approved: it jumps ahead of the agent's own suggestions.
  const row = (await listTopics(await getDb(), { tenantId: tenant, limit: 500 })).find((t) => t.topic === topic);
  if (row) await setTopicStatus(await getDb(), row.id, 'approved');
  await audit(user, 'topic.add', tenant, { topic });
  return { ok: 'Added. The agent writes it next.', reload: true };
}

export async function topicAction(_prev: FormState, data: FormData): Promise<FormState> {
  const tenant = text(data, 'tenant');
  const user = await requireUser('content:write', tenant);
  const id = text(data, 'id');
  const op = text(data, 'op');
  const db = await getDb();
  if (op === 'delete') await deleteTopic(db, id);
  else if (op === 'priority') await setTopicPriority(db, id, Math.max(0, Math.min(100, Number(text(data, 'priority')) || 0)));
  else if (['approved', 'rejected', 'suggested'].includes(op)) await setTopicStatus(db, id, op as TopicStatus, op === 'rejected' ? text(data, 'reason') || 'Rejected from the topic list' : undefined);
  else return { error: 'Unknown action.' };
  await audit(user, `topic.${op}`, tenant, { id });
  return { ok: 'Saved.', reload: true };
}
