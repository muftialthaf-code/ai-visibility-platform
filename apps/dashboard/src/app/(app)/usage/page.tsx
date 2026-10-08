import { usageReport } from '@avp/db';
import { listTenants } from '@avp/tenant-ops';
import { Badge, money } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { currentMonth } from '@/lib/overview';
import { getDb, getStore, safe } from '@/lib/services';

const fmtMinutes = (s: number) => `${(s / 60).toFixed(1)} min`;

export default async function UsagePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireUser('reports:read');
  const q = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(q.month ?? '') ? q.month! : currentMonth();
  const res = await safe(async () => ({ rows: await usageReport(await getDb(), month), tenants: await listTenants(getStore()).catch(() => []) }));
  if (!res.ok) return <><h1>Costs and usage</h1><div className="alert bad" role="alert">Could not load usage: {res.error}</div></>;
  const { rows, tenants } = res.value;
  const budgets = new Map(tenants.map((t) => [t.id, t.monthlyBudgetUsd ?? 0]));
  const total = rows.reduce((n, r) => n + r.cost_usd, 0);
  const seconds = rows.reduce((n, r) => n + r.run_seconds, 0);
  const articles = rows.reduce((n, r) => n + r.succeeded + r.held, 0);
  return (
    <>
      <h1>Costs and usage</h1>
      <p className="muted">What the agent cost and how long it ran, per business. Run time is measured from real runs; use it to check the GitHub Actions estimate in the docs.</p>
      <form className="row card" method="get">
        <label className="small" htmlFor="month" style={{ margin: 0 }}>Month</label>
        <input id="month" name="month" type="month" defaultValue={month} style={{ width: '10rem' }} />
        <button className="btn secondary" type="submit">Show</button>
      </form>
      <div className="grid">
        <div className="card"><div className="stat">{money(total)}</div><div className="muted small">model and search spend</div></div>
        <div className="card"><div className="stat">{articles}</div><div className="muted small">articles written</div></div>
        <div className="card"><div className="stat">{articles ? money(total / articles) : '-'}</div><div className="muted small">average cost per article</div></div>
        <div className="card"><div className="stat">{fmtMinutes(seconds)}</div><div className="muted small">run time (an estimate of Actions minutes, before rounding up each job)</div></div>
      </div>
      {rows.length === 0 ? <div className="card muted">No agent runs in {month}.</div> : (
        <div className="card tablewrap"><table>
          <thead><tr><th>Business</th><th>Spend</th><th>Budget</th><th>Articles</th><th>Held</th><th>Failed</th><th>Run time</th><th>Per article</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const budget = budgets.get(r.tenant_id) ?? 0;
              const pct = budget > 0 ? Math.round((r.cost_usd / budget) * 100) : null;
              const n = r.succeeded + r.held;
              return (
                <tr key={r.tenant_id}>
                  <td><a href={`/businesses/${r.tenant_id}`}>{r.tenant_id}</a></td>
                  <td>{money(r.cost_usd)}</td>
                  <td>{budget > 0 ? <>{money(budget)} <Badge tone={pct! >= 100 ? 'bad' : pct! >= 80 ? 'warn' : 'ok'}>{pct}%</Badge></> : <span className="muted">no cap</span>}</td>
                  <td>{r.succeeded}</td><td>{r.held}</td><td>{r.failed ? <Badge tone="bad">{r.failed}</Badge> : 0}</td>
                  <td>{fmtMinutes(r.run_seconds)}</td>
                  <td>{n ? money(r.cost_usd / n) : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
    </>
  );
}
