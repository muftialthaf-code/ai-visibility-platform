import { listInvites, listOnboarding } from '@avp/db';
import { ActionForm } from '@/components/ActionForm';
import { Badge, ago } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { slugify } from '@/lib/sections';
import { getDb, safe } from '@/lib/services';
import { acceptRequestAction, createInviteAction, rejectRequestAction, revokeInviteAction } from './actions';

export default async function ClientsPage() {
  await requireUser('users:manage');
  const res = await safe(async () => ({ invites: await listInvites(await getDb()), requests: await listOnboarding(await getDb()) }));
  if (!res.ok) return <><h1>Clients</h1><div className="alert bad" role="alert">The database is not reachable: {res.error}</div></>;
  const { invites, requests } = res.value;
  const pending = requests.filter((r) => r.status === 'pending');
  return (
    <>
      <h1>Clients</h1>
      <p className="muted">Invite a client to describe their business in a form. You review their answers here, then turn them into a business, finish the setup and launch it. To give the client a login for their reports, add a user with the Client role under Settings.</p>

      <h2>Waiting for you ({pending.length})</h2>
      {pending.length === 0 && <div className="card muted">No new client details.</div>}
      {pending.map((r) => (
        <div className="card" key={r.id}>
          <h3 style={{ marginTop: 0 }}>{r.data.businessName} <span className="muted small">sent {ago(r.created_at)} by {r.data.contactName} ({r.data.contactEmail})</span></h3>
          <p>{r.data.description}</p>
          <dl className="small">
            {r.data.audience && <><dt className="muted">Customers</dt><dd>{r.data.audience}</dd></>}
            {r.data.services && <><dt className="muted">Services</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{r.data.services}</dd></>}
            {r.data.competitors && <><dt className="muted">Competitors</dt><dd>{r.data.competitors}</dd></>}
            {r.data.notes && <><dt className="muted">Notes</dt><dd>{r.data.notes}</dd></>}
            <dt className="muted">Languages</dt><dd>{(r.data.languages ?? []).join(', ')}</dd>
          </dl>
          <div className="grid">
            <ActionForm action={acceptRequestAction} submit="Create the business">
              <input type="hidden" name="id" value={r.id} />
              <label htmlFor={`tid-${r.id}`}>Business id</label>
              <input id={`tid-${r.id}`} name="tenantId" type="text" defaultValue={slugify(r.data.businessName)} />
              <label htmlFor={`dom-${r.id}`}>Domain</label>
              <input id={`dom-${r.id}`} name="domain" type="text" defaultValue={r.data.domain} placeholder="example.com" />
            </ActionForm>
            <ActionForm action={rejectRequestAction} submit="Reject" submitClass="btn secondary">
              <input type="hidden" name="id" value={r.id} />
              <label htmlFor={`note-${r.id}`}>Reason (private)</label>
              <input id={`note-${r.id}`} name="note" type="text" />
            </ActionForm>
          </div>
        </div>
      ))}

      <h2>Invite a client</h2>
      <div className="card" style={{ maxWidth: '34rem' }}>
        <ActionForm action={createInviteAction} submit="Create invite link">
          <label htmlFor="label">Label <span className="hint">(who is it for?)</span></label>
          <input id="label" name="label" type="text" required maxLength={120} />
          <label htmlFor="days">Valid for (days)</label>
          <input id="days" name="days" type="number" min={1} max={30} defaultValue={7} />
        </ActionForm>
      </div>

      <h2>Invites</h2>
      {invites.length === 0 ? <p className="muted">None yet.</p> : (
        <div className="card tablewrap"><table>
          <thead><tr><th>Label</th><th>Created</th><th>Status</th><th /></tr></thead>
          <tbody>
            {invites.map((i) => {
              const expired = new Date(i.expires_at) < new Date();
              return (
                <tr key={i.id}>
                  <td>{i.label}<div className="muted small">by {i.created_by}</div></td>
                  <td>{ago(i.created_at)}</td>
                  <td>{i.used_at ? <Badge tone="off">used</Badge> : expired ? <Badge tone="warn">expired</Badge> : <Badge tone="ok">open</Badge>}</td>
                  <td>{!i.used_at && !expired && <ActionForm action={revokeInviteAction} submit="Revoke" submitClass="btn secondary"><input type="hidden" name="id" value={i.id} /></ActionForm>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
    </>
  );
}
