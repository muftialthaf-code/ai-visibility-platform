import { Badge, ago, money } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { loadDrafts } from '@/lib/review';
import { getGitHub, githubConfigured, safe } from '@/lib/services';
import { QueueTable, type Row } from './BulkApprove';
import { LABEL } from '@avp/agent/review';

export default async function ReviewQueue({ searchParams }: { searchParams: Promise<{ tenant?: string; checks?: string }> }) {
  const user = await requireUser('review:read');
  const q = await searchParams;
  if (!githubConfigured()) {
    return (
      <>
        <h1>Review queue</h1>
        <div className="alert" role="alert">GitHub is not connected, so drafts cannot be loaded. Add the connection under Settings, then Connections.</div>
      </>
    );
  }
  const res = await safe(() => loadDrafts(getGitHub()));
  const all = res.ok ? res.value : [];
  const drafts = all.filter((d) => (!q.tenant || d.review.tenantId === q.tenant) && (q.checks === 'failed' ? !d.review.gatesPassed : q.checks === 'passed' ? d.review.gatesPassed : true));
  const tenants = [...new Set(all.map((d) => d.review.tenantId))].sort();
  const rows: Row[] = drafts.map((d) => ({
    pr: d.pr.number,
    tenantId: d.review.tenantId,
    title: d.pr.title.replace(/^\[[^\]]+\]\s*/, ''),
    topic: d.review.topic.topic,
    languages: d.review.languages,
    risk: d.review.risk,
    passed: d.review.gatesPassed && can(user, 'review:act', d.review.tenantId),
    failing: d.review.checks.filter((c) => !c.passed && c.severity === 'blocker').length,
    age: ago(d.pr.createdAt),
    changesRequested: d.pr.labels.includes(LABEL.changes),
  }));
  const spend = all.reduce((n, d) => n + d.review.cost.usd, 0);
  return (
    <>
      <h1>Review queue</h1>
      <p className="muted">Articles the agent has written and is waiting for you to approve. Nothing is published until you do, unless a business is set to publish automatically.</p>
      <div className="grid">
        <div className="card"><div className="stat">{all.length}</div><div className="muted small">waiting</div></div>
        <div className="card"><div className="stat">{all.filter((d) => d.review.gatesPassed).length}</div><div className="muted small">passed every check</div></div>
        <div className="card"><div className="stat">{all.filter((d) => !d.review.gatesPassed).length}</div><div className="muted small">held, a check failed</div></div>
        <div className="card"><div className="stat">{money(spend)}</div><div className="muted small">spent writing these</div></div>
      </div>
      <form className="row card" method="get">
        <label className="small" htmlFor="tenant" style={{ margin: 0 }}>Business</label>
        <select id="tenant" name="tenant" defaultValue={q.tenant ?? ''} style={{ width: '12rem' }}>
          <option value="">all</option>
          {tenants.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="small" htmlFor="checks" style={{ margin: 0 }}>Checks</label>
        <select id="checks" name="checks" defaultValue={q.checks ?? ''} style={{ width: '9rem' }}>
          <option value="">any</option><option value="passed">all passed</option><option value="failed">failed</option>
        </select>
        <button className="btn secondary" type="submit">Filter</button>
      </form>
      {!res.ok && <div className="alert bad" role="alert">GitHub could not be reached: {res.error}</div>}
      {res.ok && rows.length === 0 && <div className="card muted">{all.length ? 'No drafts match.' : 'Nothing is waiting. New drafts appear here after the agent runs.'}</div>}
      {rows.length > 0 && <QueueTable rows={rows} />}
      <p className="muted small"><Badge tone="off">tip</Badge> Drafts that failed a check were revised once by the agent already. Open one to see which check failed.</p>
    </>
  );
}
