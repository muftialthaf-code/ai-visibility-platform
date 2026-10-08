import { redirect } from 'next/navigation';
import { weeklyVisibility } from '@avp/db';
import { listTenants } from '@avp/tenant-ops';
import { Badge } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { delta, percent, series } from '@/lib/reports';
import { getDb, getStore, safe } from '@/lib/services';

export default async function ReportsPage() {
  const user = await requireUser();
  // A client sees only their own business, so there is nothing to choose from.
  if (user.role === 'client') redirect(user.tenant_id && can(user, 'reports:read', user.tenant_id) ? `/reports/${user.tenant_id}` : '/forbidden');
  await requireUser('reports:read');
  const res = await safe(async () => {
    const db = await getDb();
    const tenants = (await listTenants(getStore())).filter((t) => t.valid && t.status === 'active');
    return Promise.all(tenants.map(async (t) => ({ t, points: series(await weeklyVisibility(db, t.id, 12)) })));
  });
  return (
    <>
      <h1>AI visibility reports</h1>
      <p className="muted">How often AI assistants mention and cite each business when asked the questions its customers ask. Measured weekly.</p>
      {!res.ok && <div className="alert bad" role="alert">Could not load reports: {res.error}</div>}
      {res.ok && res.value.length === 0 && <div className="card muted">No active businesses yet.</div>}
      {res.ok && res.value.length > 0 && (
        <div className="card tablewrap"><table>
          <thead><tr><th>Business</th><th>Mentioned (latest week)</th><th>Change</th><th>Cited with a link</th><th>Questions asked</th></tr></thead>
          <tbody>
            {res.value.map(({ t, points }) => {
              const last = points.filter((p) => p.asked > 0).at(-1);
              const d = delta(points);
              return (
                <tr key={t.id}>
                  <td><a href={`/reports/${t.id}`}>{t.name ?? t.id}</a></td>
                  <td>{last ? percent(last.mentioned) : <span className="muted">not measured yet</span>}</td>
                  <td>{d === null ? <span className="muted">-</span> : <Badge tone={d > 0 ? 'ok' : d < 0 ? 'bad' : 'off'}>{d > 0 ? '+' : ''}{d} pts</Badge>}</td>
                  <td>{last ? percent(last.cited) : '-'}</td>
                  <td>{last?.asked ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
    </>
  );
}
