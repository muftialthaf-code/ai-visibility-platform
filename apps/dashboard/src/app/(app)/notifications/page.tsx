import { listNotifications } from '@avp/db';
import { Badge, ago } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { getDb, safe } from '@/lib/services';

export default async function NotificationsPage() {
  await requireUser('runs:read');
  const res = await safe(async () => listNotifications(await getDb(), 100));
  return (
    <>
      <h1>Notifications</h1>
      <p className="muted">Everything the platform has told you about: new drafts, failures, budget warnings and reminders. Emails go to the addresses under Settings.</p>
      {!res.ok && <div className="alert bad" role="alert">The database is not reachable: {res.error}</div>}
      {res.ok && res.value.length === 0 && <div className="card muted">Nothing yet.</div>}
      {res.ok && res.value.length > 0 && (
        <div className="card tablewrap"><table>
          <thead><tr><th>When</th><th>Business</th><th>What</th><th>Email</th></tr></thead>
          <tbody>
            {res.value.map((n) => (
              <tr key={n.id}>
                <td>{ago(n.at)}</td>
                <td>{n.tenant_id ?? '-'}</td>
                <td>{n.pr_number ? <a href={`/review/${n.pr_number}`}>{n.subject}</a> : n.subject}<div className="muted small"><Badge tone={['failure', 'budget'].includes(n.kind) ? 'bad' : n.kind === 'budget-warning' || n.kind === 'held' ? 'warn' : 'off'}>{n.kind}</Badge></div></td>
                <td>{n.email_error ? <span className="error small">{n.email_error}</span> : n.emailed_at ? 'sent' : <span className="muted">not sent</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  );
}
