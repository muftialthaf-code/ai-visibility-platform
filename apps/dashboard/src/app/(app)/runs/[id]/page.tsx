import { notFound } from 'next/navigation';
import { getRun } from '@avp/db';
import { Badge, duration, money, when } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { getDb } from '@/lib/services';

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser('runs:read');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const run = await getRun(await getDb(), id);
  if (!run) notFound();
  const tone = run.status === 'success' ? 'ok' : run.status === 'failed' ? 'bad' : run.status === 'held' ? 'warn' : 'off';
  return (
    <>
      <p className="small"><a href="/runs">← Runs</a></p>
      <h1>{run.kind} run for {run.tenant_id}</h1>
      <p><Badge tone={tone}>{run.status}</Badge> <span className="muted">started {when(run.started_at)} · {duration(run.started_at, run.finished_at)} · {run.trigger}</span></p>
      {run.error && <div className="alert bad" role="alert"><strong>Error:</strong> {run.error}</div>}
      <div className="grid">
        <div className="card"><div className="stat">{money(run.cost_usd)}</div><div className="muted small">cost</div></div>
        <div className="card"><div className="stat">{run.tokens_in.toLocaleString()} / {run.tokens_out.toLocaleString()}</div><div className="muted small">tokens in / out</div></div>
      </div>
      {run.topic && <div className="card"><strong>Topic</strong><p>{run.topic}</p></div>}
      {(run.article_url || run.pr_number || run.github_run_url) && (
        <div className="card">
          {run.article_url && <p>Live article: <a href={run.article_url}>{run.article_url}</a></p>}
          {run.pr_number && <p>Pull request #{run.pr_number}{run.status === 'held' || run.status === 'success' ? <> · <a href="/review">Review queue</a></> : null}</p>}
          {run.github_run_url && <p><a href={run.github_run_url}>Full log on GitHub</a></p>}
        </div>
      )}
      <h2>Steps</h2>
      {run.steps.length === 0 ? <p className="muted">No steps recorded.</p> : (
        <div className="card tablewrap"><table><tbody>
          {run.steps.map((s, i) => <tr key={i}><td>{s.name}</td><td><Badge tone={s.status === 'ok' ? 'ok' : s.status === 'failed' ? 'bad' : 'off'}>{s.status}</Badge></td><td>{s.ms !== undefined ? `${(s.ms / 1000).toFixed(1)}s` : ''}</td><td className="muted">{s.detail}</td></tr>)}
        </tbody></table></div>
      )}
      <h2>Quality checks</h2>
      {run.checks.length === 0 ? <p className="muted">No checks recorded.</p> : (
        <div className="card tablewrap"><table><tbody>
          {run.checks.map((c, i) => <tr key={i}><td>{c.name}</td><td><Badge tone={c.passed ? 'ok' : 'bad'}>{c.passed ? 'passed' : 'failed'}</Badge></td><td className="muted">{c.reason}</td></tr>)}
        </tbody></table></div>
      )}
      <h2>Sources</h2>
      {run.sources.length === 0 ? <p className="muted">No sources recorded.</p> : (
        <ul>{run.sources.map((s, i) => <li key={i}><a href={s.url} rel="noopener noreferrer">{s.title ?? s.url}</a>{s.date ? <span className="muted"> · {s.date}</span> : null}</li>)}</ul>
      )}
    </>
  );
}
