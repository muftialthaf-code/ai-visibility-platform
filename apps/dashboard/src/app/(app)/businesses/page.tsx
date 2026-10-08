import { listTenants } from '@avp/tenant-ops';
import { ActionForm } from '@/components/ActionForm';
import { Badge } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getStore, safe } from '@/lib/services';
import { pauseAllAction } from './actions';

export default async function BusinessesPage() {
  const user = await requireUser('tenants:read');
  const res = await safe(() => listTenants(getStore()));
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Businesses</h1>
          <p className="muted">Each business is a config file in the repository. Every change here is validated and saved as a commit.</p>
        </div>
        {can(user, 'tenants:lifecycle') && <a className="btn" href="/businesses/new">Add a business</a>}
      </div>

      {!res.ok && <div className="alert bad" role="alert">GitHub is not reachable, so businesses cannot be listed: {res.error}</div>}

      {res.ok && res.value.length === 0 && <div className="card">No businesses yet.</div>}
      {res.ok && res.value.length > 0 && (
        <div className="card tablewrap">
          <table>
            <thead><tr><th>Business</th><th>Site</th><th>Agent</th><th>Publishing</th><th>Per day</th><th>Budget</th><th>Languages</th></tr></thead>
            <tbody>
              {res.value.map((t) => (
                <tr key={t.id}>
                  <td><a href={`/businesses/${t.id}`}>{t.name ?? t.id}</a><div className="muted small">{t.id} · {t.domain}</div></td>
                  <td>{!t.valid ? <Badge tone="bad">invalid</Badge> : t.status === 'active' ? <Badge tone="ok">active</Badge> : <Badge tone="off">paused</Badge>}</td>
                  <td>{!t.valid ? '' : t.agentPaused ? <Badge tone="warn">paused</Badge> : <Badge tone="ok">on</Badge>}</td>
                  <td>{t.publishMode === 'auto' ? 'Auto-publish' : t.publishMode ? 'Approval first' : ''}</td>
                  <td>{t.articlesPerDay ?? ''}</td>
                  <td>{t.monthlyBudgetUsd ? `$${t.monthlyBudgetUsd}` : <span className="muted">no cap</span>}</td>
                  <td>{t.languages?.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {can(user, 'agent:control') && res.ok && res.value.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Agent controls for every business</h2>
          <div className="row">
            <ActionForm action={pauseAllAction} submit="Pause all agents" submitClass="btn danger"><input type="hidden" name="paused" value="true" /></ActionForm>
            <ActionForm action={pauseAllAction} submit="Resume all agents" submitClass="btn secondary"><input type="hidden" name="paused" value="false" /></ActionForm>
          </div>
          <p className="small muted">Pausing stops new articles everywhere without taking any site offline.</p>
        </div>
      )}
    </>
  );
}
