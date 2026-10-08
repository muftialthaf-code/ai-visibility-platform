import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { loadOverview } from '@/lib/overview';
import { Badge, ago, money, when } from '@/components/ui';

export default async function OverviewPage() {
  // Clients have one screen: their own reports.
  if ((await requireUser()).role === 'client') redirect('/reports');
  await requireUser('overview:read');
  const o = await loadOverview();
  const pending = o.tenants.reduce((a, t) => a + t.pendingReviews, 0);
  const failures = o.tenants.reduce((a, t) => a + t.failed, 0);
  const published = o.tenants.reduce((a, t) => a + t.published, 0);
  const pct = o.budget > 0 ? Math.round((o.spend / o.budget) * 100) : null;

  return (
    <>
      <h1>Overview</h1>
      <p className="muted">Every business at a glance.</p>

      {o.problems.map((p) => (
        <div key={p} className="alert bad" role="alert">{p}</div>
      ))}

      <div className="grid">
        <div className="card"><div className="stat">{o.tenants.filter((t) => t.status === 'active').length}</div><div className="muted small">active of {o.tenants.length} businesses</div></div>
        <div className="card"><div className="stat">{published}</div><div className="muted small">articles published this week</div></div>
        <div className="card"><div className="stat">{pending}</div><div className="muted small">{pending === 1 ? 'article' : 'articles'} waiting for review {pending > 0 && <a href="/review">Open</a>}</div></div>
        <div className="card"><div className="stat">{failures}</div><div className="muted small">failed runs this week</div></div>
        <div className="card">
          <div className="stat">{money(o.spend)}</div>
          <div className="muted small">spent this month{o.budget > 0 ? ` of ${money(o.budget)} (${pct}%)` : ' (no budget caps set)'}</div>
        </div>
      </div>

      <h2>Alerts</h2>
      {o.alerts.length === 0 ? (
        <p className="muted">Nothing needs attention.</p>
      ) : (
        o.alerts.map((a, i) => (
          <div key={i} className={`alert ${a.level}`}>{a.href ? <a href={a.href}>{a.text}</a> : a.text}</div>
        ))
      )}

      <h2>Businesses</h2>
      {o.tenants.length === 0 ? (
        <div className="card">No businesses yet. <a href="/businesses/new">Add the first one</a>.</div>
      ) : (
        <div className="card tablewrap">
          <table>
            <thead>
              <tr><th>Business</th><th>State</th><th>Last run</th><th>Next run</th><th>Published (7d)</th><th>Reviews</th><th>Failures (7d)</th><th>Spend</th></tr>
            </thead>
            <tbody>
              {o.tenants.map((t) => (
                <tr key={t.id}>
                  <td><a href={`/businesses/${t.id}`}>{t.name ?? t.id}</a><div className="muted small">{t.domain}</div></td>
                  <td>
                    {!t.valid ? <Badge tone="bad">invalid</Badge> : t.status === 'active' ? <Badge tone="ok">active</Badge> : <Badge tone="off">paused</Badge>}{' '}
                    {t.valid && t.agentPaused && <Badge tone="warn">agent paused</Badge>}
                    <div className="muted small">{t.publishMode === 'auto' ? 'auto-publish' : t.publishMode === 'approval' ? 'approval first' : ''}</div>
                  </td>
                  <td>{t.lastRun ? <><Badge tone={t.lastRun.status === 'success' ? 'ok' : t.lastRun.status === 'failed' ? 'bad' : t.lastRun.status === 'held' ? 'warn' : 'off'}>{t.lastRun.status}</Badge><div className="muted small">{ago(t.lastRun.started_at)}</div></> : <span className="muted">never</span>}</td>
                  <td>{t.nextRun ? when(t.nextRun) : <span className="muted">not scheduled</span>}</td>
                  <td>{t.published}</td>
                  <td>{t.pendingReviews > 0 ? <a href={`/review?tenant=${t.id}`}>{t.pendingReviews}</a> : 0}</td>
                  <td>{t.failed > 0 ? <a href={`/runs?tenant=${t.id}&status=failed`}>{t.failed}</a> : 0}</td>
                  <td>{money(t.spend)}{(t.monthlyBudgetUsd ?? 0) > 0 && <div className="muted small">of {money(t.monthlyBudgetUsd!)}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">Scheduled runs can start a few minutes after their time, because GitHub delays scheduled workflows under load.</p>
    </>
  );
}
