import { listTopics, type TopicStatus } from '@avp/db';
import { ActionForm } from '@/components/ActionForm';
import { Badge, ago } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb, safe } from '@/lib/services';
import { addTopicAction } from './actions';
import { TopicRow } from './TopicRow';

const STATUSES: TopicStatus[] = ['approved', 'suggested', 'used', 'rejected', 'duplicate'];

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ tenant?: string; status?: string }> }) {
  const user = await requireUser('review:read');
  const q = await searchParams;
  const tenant = (q.tenant ?? '').trim();
  const status = STATUSES.includes(q.status as TopicStatus) ? (q.status as TopicStatus) : undefined;
  const res = await safe(async () => (tenant ? listTopics(await getDb(), { tenantId: tenant, status, limit: 200 }) : []));
  const canWrite = tenant ? can(user, 'content:write', tenant) : false;
  return (
    <>
      <h1>Topics</h1>
      <p className="muted">What the agent will write about. It finds topics itself when the list runs dry; add your own and they go first.</p>
      <form className="row card" method="get">
        <label className="small" htmlFor="tenant" style={{ margin: 0 }}>Business</label>
        <input id="tenant" name="tenant" type="text" defaultValue={tenant} placeholder="business id" style={{ width: '12rem' }} />
        <label className="small" htmlFor="status" style={{ margin: 0 }}>Status</label>
        <select id="status" name="status" defaultValue={q.status ?? ''} style={{ width: '9rem' }}>
          <option value="">any</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn secondary" type="submit">Show</button>
      </form>
      {!res.ok && <div className="alert bad" role="alert">The database is not reachable: {res.error}</div>}
      {!tenant && <div className="card muted">Enter a business id to see its topics.</div>}
      {canWrite && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Add a topic</h3>
          <ActionForm action={addTopicAction} submit="Add">
            <input type="hidden" name="tenant" value={tenant} />
            <label htmlFor="topic">Topic</label>
            <input id="topic" name="topic" type="text" required placeholder="How do I choose a plan for a two week trip?" />
            <label htmlFor="question">Question it answers (optional)</label>
            <input id="question" name="question" type="text" />
          </ActionForm>
        </div>
      )}
      {res.ok && tenant && res.value.length === 0 && <div className="card muted">No topics yet. The agent searches for some on its next run.</div>}
      {res.ok && res.value.length > 0 && (
        <div className="card tablewrap">
          <table>
            <thead><tr><th>Topic</th><th>Status</th><th>Priority</th><th>Added</th>{canWrite && <th>Change</th>}</tr></thead>
            <tbody>
              {res.value.map((t) => (
                <tr key={t.id}>
                  <td>{t.topic}<div className="muted small">{t.question !== t.topic ? t.question : null}{t.reason ? ` · ${t.reason}` : ''}</div></td>
                  <td><Badge tone={t.status === 'approved' ? 'ok' : t.status === 'rejected' || t.status === 'duplicate' ? 'bad' : 'off'}>{t.status}</Badge></td>
                  <td>{t.priority}</td>
                  <td>{ago(t.created_at)}</td>
                  {canWrite && <td><TopicRow id={t.id} tenant={tenant} status={t.status} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
