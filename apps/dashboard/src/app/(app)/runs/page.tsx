import { listRuns, type RunKind, type RunStatus } from '@avp/db';
import { Badge, ago, duration, money } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { getDb, safe } from '@/lib/services';

const STATUSES: RunStatus[] = ['running', 'success', 'held', 'failed', 'skipped'];
const tone = (s: string) => (s === 'success' ? 'ok' : s === 'failed' ? 'bad' : s === 'held' ? 'warn' : 'off') as 'ok' | 'bad' | 'warn' | 'off';

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ tenant?: string; status?: string; kind?: string }> }) {
  await requireUser('runs:read');
  const q = await searchParams;
  const res = await safe(async () =>
    listRuns(await getDb(), {
      tenantId: q.tenant || undefined,
      status: STATUSES.includes(q.status as RunStatus) ? (q.status as RunStatus) : undefined,
      kind: ['agent', 'tracker', 'deploy'].includes(q.kind ?? '') ? (q.kind as RunKind) : undefined,
      limit: 100,
    }),
  );
  return (
    <>
      <h1>Runs</h1>
      <p className="muted">Every agent, tracker and deploy run, with its outcome and cost.</p>
      <form className="row card" method="get">
        <label className="small" htmlFor="tenant" style={{ margin: 0 }}>Business</label>
        <input id="tenant" name="tenant" type="text" defaultValue={q.tenant ?? ''} placeholder="any" style={{ width: '10rem' }} />
        <label className="small" htmlFor="status" style={{ margin: 0 }}>Status</label>
        <select id="status" name="status" defaultValue={q.status ?? ''} style={{ width: '9rem' }}>
          <option value="">any</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="small" htmlFor="kind" style={{ margin: 0 }}>Kind</label>
        <select id="kind" name="kind" defaultValue={q.kind ?? ''} style={{ width: '8rem' }}>
          <option value="">any</option>
          <option value="agent">agent</option><option value="tracker">tracker</option><option value="deploy">deploy</option>
        </select>
        <button className="btn secondary" type="submit">Filter</button>
      </form>
      {!res.ok && <div className="alert bad" role="alert">The database is not reachable: {res.error}</div>}
      {res.ok && res.value.length === 0 && <div className="card muted">No runs match.</div>}
      {res.ok && res.value.length > 0 && (
        <div className="card tablewrap">
          <table>
            <thead><tr><th>Started</th><th>Business</th><th>Kind</th><th>Status</th><th>Topic</th><th>Took</th><th>Cost</th></tr></thead>
            <tbody>
              {res.value.map((r) => (
                <tr key={r.id}>
                  <td><a href={`/runs/${r.id}`}>{ago(r.started_at)}</a><div className="muted small">{r.trigger}</div></td>
                  <td>{r.tenant_id}</td>
                  <td>{r.kind}</td>
                  <td><Badge tone={tone(r.status)}>{r.status}</Badge></td>
                  <td>{r.topic ?? <span className="muted">-</span>}{r.error && <div className="error small">{r.error.slice(0, 120)}</div>}</td>
                  <td>{duration(r.started_at, r.finished_at)}</td>
                  <td>{money(r.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
