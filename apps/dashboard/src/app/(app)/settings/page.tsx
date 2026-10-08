import { getSetting, listAudit, listUsers } from '@avp/db';
import { DEFAULT_GLOBALS, DEFAULT_NOTIFICATIONS, parseGlobals, parseNotifications } from '@avp/runtime';
import { ActionForm } from '@/components/ActionForm';
import { Badge, ago } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { connectionStatus } from '@/lib/env';
import { getDb } from '@/lib/services';
import { createUserAction, saveDefaultsAction, saveNotificationsAction, updateUserAction } from './actions';

const TABS = [
  { key: 'users', title: 'Users and roles' },
  { key: 'defaults', title: 'Global defaults' },
  { key: 'notifications', title: 'Notifications' },
  { key: 'connections', title: 'Connections' },
  { key: 'audit', title: 'Audit log' },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireUser('users:manage');
  const { tab = 'users' } = await searchParams;
  const db = await getDb();
  return (
    <>
      <h1>Settings</h1>
      <div className="tabs">
        {TABS.map((t) => <a key={t.key} href={`/settings?tab=${t.key}`} aria-current={tab === t.key ? 'page' : undefined}>{t.title}</a>)}
      </div>

      {tab === 'users' && <Users />}

      {tab === 'defaults' && (
        <Defaults values={parseGlobals(await getSetting(db, 'defaults', DEFAULT_GLOBALS))} />
      )}

      {tab === 'notifications' && (
        <Notifications values={parseNotifications(await getSetting(db, 'notifications', DEFAULT_NOTIFICATIONS))} />
      )}

      {tab === 'connections' && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Connections</h2>
          <p className="muted">Keys are stored as secrets on the hosts and are never shown here. This page only tells you whether each one is set. To change one, update it in the dashboard host settings (and in the repository&apos;s Actions secrets for the agent).</p>
          <table>
            <tbody>
              {connectionStatus().map((c) => (
                <tr key={c.name}><td>{c.name}</td><td>{c.ok ? <Badge tone="ok">set</Badge> : <Badge tone="warn">not set</Badge>}</td><td className="muted small">{c.hint}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'audit' && <Audit />}
    </>
  );
}

async function Users() {
  const users = await listUsers(await getDb());
  return (
    <>
      <div className="card tablewrap">
        <table>
          <thead><tr><th>Email</th><th>Role</th><th>2FA</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}{u.tenant_id && <div className="muted small">business: {u.tenant_id}</div>}</td>
                <td>{u.role}</td>
                <td>{u.totp_enabled ? <Badge tone="ok">on</Badge> : <Badge tone="warn">off</Badge>}</td>
                <td>{u.disabled ? <Badge tone="bad">disabled</Badge> : <Badge tone="ok">active</Badge>}</td>
                <td>
                  <div className="row">
                    <ActionForm action={updateUserAction} submit={u.disabled ? 'Enable' : 'Disable'} submitClass="btn secondary"><input type="hidden" name="id" value={u.id} /><input type="hidden" name="op" value={u.disabled ? 'enable' : 'disable'} /></ActionForm>
                    {u.totp_enabled && <ActionForm action={updateUserAction} submit="Reset 2FA" submitClass="btn secondary"><input type="hidden" name="id" value={u.id} /><input type="hidden" name="op" value="reset-2fa" /></ActionForm>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ maxWidth: '34rem' }}>
        <h2 style={{ marginTop: 0 }}>Add a user</h2>
        <p className="muted small">Owner: everything. Editor: businesses, content and reviews. Reviewer: review queue only. Client: their own business&apos;s reports only.</p>
        <ActionForm action={createUserAction} submit="Create user">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required />
          <label htmlFor="role">Role</label>
          <select id="role" name="role" defaultValue="reviewer">
            <option value="owner">Owner</option><option value="editor">Editor</option><option value="reviewer">Reviewer</option><option value="client">Client</option>
          </select>
          <label htmlFor="tenantId">Business id <span className="hint">(clients only)</span></label>
          <input id="tenantId" name="tenantId" type="text" />
          <label htmlFor="password">Temporary password <span className="hint">(at least 12 characters)</span></label>
          <input id="password" name="password" type="password" required minLength={12} autoComplete="new-password" />
        </ActionForm>
      </div>
    </>
  );
}

function Defaults({ values }: { values: ReturnType<typeof parseGlobals> }) {
  return (
    <div className="card" style={{ maxWidth: '34rem' }}>
      <h2 style={{ marginTop: 0 }}>Global defaults</h2>
      <ActionForm action={saveDefaultsAction} submit="Save defaults">
        <label htmlFor="monthlyBudgetUsd">Monthly budget for new businesses (USD) <span className="hint">0 means no cap</span></label>
        <input id="monthlyBudgetUsd" name="monthlyBudgetUsd" type="number" min={0} step={1} defaultValue={values.monthlyBudgetUsd} />
        <label htmlFor="defaultLanguage">Default language for new businesses</label>
        <input id="defaultLanguage" name="defaultLanguage" type="text" defaultValue={values.defaultLanguage} />
        <h3>Quality-check thresholds</h3>
        <label htmlFor="maxDuplicateSimilarity">Duplicate similarity limit <span className="hint">0.1 to 1. An article more similar than this to an existing one is rejected.</span></label>
        <input id="maxDuplicateSimilarity" name="maxDuplicateSimilarity" type="number" min={0.1} max={1} step={0.05} defaultValue={values.maxDuplicateSimilarity} />
        <label htmlFor="minSources">Minimum cited sources</label>
        <input id="minSources" name="minSources" type="number" min={0} max={20} step={1} defaultValue={values.minSources} />
        <label htmlFor="minReadability">Minimum readability (Flesch reading ease, English)</label>
        <input id="minReadability" name="minReadability" type="number" min={0} max={100} step={1} defaultValue={values.minReadability} />
        <label htmlFor="autoApproveMaxRisk">Auto-approve only at or below this risk score <span className="hint">0 to 100</span></label>
        <input id="autoApproveMaxRisk" name="autoApproveMaxRisk" type="number" min={0} max={100} step={1} defaultValue={values.autoApproveMaxRisk} />
      </ActionForm>
    </div>
  );
}

function Notifications({ values }: { values: ReturnType<typeof parseNotifications> }) {
  return (
    <div className="card" style={{ maxWidth: '34rem' }}>
      <h2 style={{ marginTop: 0 }}>Notifications</h2>
      <p className="muted small">Email is sent through the configured email provider (see Connections).</p>
      <ActionForm action={saveNotificationsAction} submit="Save notifications">
        <label htmlFor="emails">Who gets notified <span className="hint">(email addresses, separated by commas or new lines)</span></label>
        <textarea id="emails" name="emails" defaultValue={values.emails.join('\n')} />
        <label style={{ fontWeight: 500 }}><input type="checkbox" name="notifyOnNewDraft" defaultChecked={values.notifyOnNewDraft} /> When a new draft is waiting for review</label>
        <label style={{ fontWeight: 500 }}><input type="checkbox" name="notifyOnFailure" defaultChecked={values.notifyOnFailure} /> When a run fails</label>
        <label htmlFor="reminderAfterHours">Remind me about unreviewed drafts after (hours) <span className="hint">0 turns reminders off</span></label>
        <input id="reminderAfterHours" name="reminderAfterHours" type="number" min={0} max={720} defaultValue={values.reminderAfterHours} />
        <label htmlFor="budgetAlertPercent">Warn when a business has used this % of its budget</label>
        <input id="budgetAlertPercent" name="budgetAlertPercent" type="number" min={1} max={100} defaultValue={values.budgetAlertPercent} />
      </ActionForm>
    </div>
  );
}

async function Audit() {
  const entries = await listAudit(await getDb(), 200);
  return (
    <div className="card tablewrap">
      <h2 style={{ marginTop: 0 }}>Audit log</h2>
      <p className="muted small">Who did what, and when. Entries cannot be edited from the dashboard.</p>
      <table>
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}><td title={e.at}>{ago(e.at)}</td><td>{e.user_email}</td><td><code>{e.action}</code></td><td>{e.target}</td><td className="muted small">{Object.keys(e.detail).length ? JSON.stringify(e.detail).slice(0, 140) : ''}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
