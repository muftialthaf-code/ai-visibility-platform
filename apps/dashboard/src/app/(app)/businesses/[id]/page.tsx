import { redirect } from 'next/navigation';
import { tenantFile, tenantHistory } from '@avp/tenant-ops';
import { ActionForm } from '@/components/ActionForm';
import { SectionFields } from '@/components/SectionForm';
import { Badge, ago } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { readiness, tabForPath } from '@/lib/readiness';
import { SECTIONS } from '@/lib/sections';
import { getStore, safe } from '@/lib/services';
import { runNowAction } from '../../review/actions';
import {
  removeBusinessAction, rollbackAction, saveAdvancedAction, saveSectionAction, setAgentPausedAction, setStatusAction,
} from '../actions';

const EXTRA_TABS = [
  { key: 'setup', title: 'Setup checklist' },
  { key: 'advanced', title: 'Advanced (JSON)' },
  { key: 'history', title: 'History' },
];

export default async function BusinessPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab = 'setup' } = await searchParams;
  const user = await requireUser('tenants:read', id);
  const canWrite = can(user, 'tenants:write', id);

  const store = getStore();
  const file = await safe(() => store.readFile(tenantFile(id)));
  if (!file.ok) return <div className="alert bad" role="alert">GitHub is not reachable: {file.error}</div>;
  // A business that does not exist (for example one just removed) goes back to the list.
  if (file.value === null) redirect('/businesses');

  let raw: any;
  try {
    raw = JSON.parse(file.value);
  } catch (e) {
    return <div className="alert bad" role="alert">tenants/{id}/tenant.json is not valid JSON. Fix it on the Advanced tab or in GitHub. ({(e as Error).message})</div>;
  }
  const languages: string[] = raw?.languages?.supported ?? ['en'];
  const ready = readiness(raw);
  const section = SECTIONS.find((s) => s.key === tab);
  const hidden = (
    <>
      <input type="hidden" name="tenant" value={id} />
      {languages.map((l) => <input key={l} type="hidden" name="lang" value={l} />)}
    </>
  );

  return (
    <>
      <p className="small"><a href="/businesses">← Businesses</a></p>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{raw?.identity?.name ?? id}</h1>
          <p className="muted">{raw?.identity?.domain} · {id}</p>
        </div>
        <div className="row">
          {raw?.status === 'active' ? <Badge tone="ok">active</Badge> : <Badge tone="off">paused</Badge>}
          {raw?.agent?.paused ? <Badge tone="warn">agent paused</Badge> : <Badge tone="ok">agent on</Badge>}
        </div>
      </div>

      <div className="tabs" role="tablist">
        {[...EXTRA_TABS.slice(0, 1), ...SECTIONS.map((s) => ({ key: s.key, title: s.title })), ...EXTRA_TABS.slice(1)].map((t) => (
          <a key={t.key} href={`/businesses/${id}?tab=${t.key}`} aria-current={tab === t.key ? 'page' : undefined}>{t.title}</a>
        ))}
      </div>

      {tab === 'setup' && (
        <>
          <h2>Launch checklist</h2>
          {ready.errors.length > 0 && (
            <div className="card">
              <strong className="error">Fix these first. They block saving or launching.</strong>
              <ul>{ready.errors.map((e, i) => <li key={i}><a href={`/businesses/${id}?tab=${tabForPath(e.path)}`}>{e.path || 'config'}</a>: {e.message}</li>)}</ul>
            </div>
          )}
          <div className="card">
            <strong>Before launch</strong>
            {ready.warnings.length === 0 && ready.suggestions.length === 0 ? <p className="success">Everything looks ready.</p> : (
              <ul>
                {ready.warnings.map((w, i) => <li key={`w${i}`}><a href={`/businesses/${id}?tab=${tabForPath(w.path)}`}>{w.path || 'config'}</a>: {w.message}</li>)}
                {ready.suggestions.map((s, i) => <li key={`s${i}`}><a href={`/businesses/${id}?tab=${s.tab}`}>{s.text}</a></li>)}
              </ul>
            )}
          </div>
          {canWrite && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>{raw?.status === 'active' ? 'Pause this business' : 'Launch this business'}</h3>
              <p className="muted small">{raw?.status === 'active' ? 'A paused business is skipped by deploys and by the agent. Its live site stays up until you take it down at the host.' : 'Launching makes the business active: it is deployed with the next push and the agent starts on its schedule (unless the agent is paused). The notes above are advice, not blockers.'}</p>
              <ActionForm action={setStatusAction} submit={raw?.status === 'active' ? 'Pause business' : 'Launch business'} submitClass={raw?.status === 'active' ? 'btn secondary' : 'btn'}>
                <input type="hidden" name="tenant" value={id} />
                <input type="hidden" name="status" value={raw?.status === 'active' ? 'paused' : 'active'} />
              </ActionForm>
              {can(user, 'agent:control', id) && (
                <ActionForm action={setAgentPausedAction} submit={raw?.agent?.paused ? 'Resume the agent' : 'Pause the agent'} submitClass="btn secondary">
                  <input type="hidden" name="tenant" value={id} />
                  <input type="hidden" name="paused" value={raw?.agent?.paused ? 'false' : 'true'} />
                </ActionForm>
              )}
              {can(user, 'agent:control', id) && raw?.status === 'active' && (
                <ActionForm action={runNowAction} submit="Write an article now" submitClass="btn secondary">
                  <input type="hidden" name="tenant" value={id} />
                  <label><input type="checkbox" name="dry" style={{ width: 'auto', marginRight: '.4rem' }} />Practice run: check the result but do not open a draft</label>
                </ActionForm>
              )}
            </div>
          )}
          {can(user, 'tenants:lifecycle', id) && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Export or remove</h3>
              <p><a className="btn secondary" href={`/businesses/${id}/export`}>Download everything as JSON</a></p>
              <ActionForm action={removeBusinessAction} submit="Remove this business permanently" submitClass="btn danger">
                <input type="hidden" name="tenant" value={id} />
                <label htmlFor="confirm">Type <code>{id}</code> to confirm. This deletes the config and every article. Export first.</label>
                <input id="confirm" name="confirm" type="text" autoComplete="off" />
              </ActionForm>
            </div>
          )}
        </>
      )}

      {section && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{section.title}</h2>
          {canWrite ? (
            <ActionForm action={saveSectionAction} submit={`Save ${section.title.toLowerCase()}`}>
              {hidden}
              <input type="hidden" name="section" value={section.key} />
              <SectionFields section={section} tenant={raw} languages={languages} />
            </ActionForm>
          ) : <p className="muted">You can view but not edit this business.</p>}
        </div>
      )}

      {tab === 'advanced' && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Advanced (JSON)</h2>
          <p className="muted">The whole config. It is validated before saving, so a mistake cannot be written. The business id cannot be changed.</p>
          {canWrite ? (
            <ActionForm action={saveAdvancedAction} submit="Save JSON">
              <input type="hidden" name="tenant" value={id} />
              <label htmlFor="json">tenant.json</label>
              <textarea id="json" name="json" defaultValue={JSON.stringify(raw, null, 2)} style={{ minHeight: '30rem', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '.85rem' }} spellCheck={false} />
            </ActionForm>
          ) : <pre>{JSON.stringify(raw, null, 2)}</pre>}
        </div>
      )}

      {tab === 'history' && <History id={id} canRollback={can(user, 'tenants:lifecycle', id)} />}
    </>
  );
}

async function History({ id, canRollback }: { id: string; canRollback: boolean }) {
  const res = await safe(() => tenantHistory(getStore(), id, 30));
  if (!res.ok) return <div className="alert bad" role="alert">Could not read history: {res.error}</div>;
  return (
    <div className="card tablewrap">
      <h2 style={{ marginTop: 0 }}>Version history</h2>
      <p className="muted small">Every save is a commit. Rolling back restores an earlier version as a new commit, so nothing is lost.</p>
      <table>
        <thead><tr><th>When</th><th>Change</th><th>By</th><th></th></tr></thead>
        <tbody>
          {res.value.map((h, i) => (
            <tr key={h.sha}>
              <td>{ago(h.date)}</td>
              <td>{h.message}<div className="muted small"><code>{h.sha.slice(0, 7)}</code></div></td>
              <td>{h.author}</td>
              <td>
                {canRollback && i > 0 && (
                  <ActionForm action={rollbackAction} submit="Restore this version" submitClass="btn secondary">
                    <input type="hidden" name="tenant" value={id} />
                    <input type="hidden" name="sha" value={h.sha} />
                  </ActionForm>
                )}
                {i === 0 && <Badge tone="ok">current</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
