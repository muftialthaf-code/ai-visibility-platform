import { competitorMentions, latestWeek, promptResults, recentAnswers, searchConsoleWeeks, weeklyVisibility } from '@avp/db';
import { getTenant } from '@avp/tenant-ops';
import { TrendChart } from '@/components/Chart';
import { PrintButton } from '@/components/PrintButton';
import { Badge } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { delta, percent, series } from '@/lib/reports';
import { getSetting } from '@avp/db';
import { DEFAULT_BRANDING, parseBranding } from '@avp/runtime';
import { getDb, getStore, safe } from '@/lib/services';

const PROVIDER_NAMES: Record<string, string> = { claude: 'Claude', perplexity: 'Perplexity', openai: 'ChatGPT' };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser('reports:read', id);
  const res = await safe(async () => {
    const db = await getDb();
    const tenant = await getTenant(getStore(), id);
    const week = await latestWeek(db, id);
    const [visibility, prompts, rivals, answers, gsc] = await Promise.all([
      weeklyVisibility(db, id, 12),
      week ? promptResults(db, id, week) : [],
      week ? competitorMentions(db, id, week) : [],
      week ? recentAnswers(db, id, week, 12) : [],
      searchConsoleWeeks(db, id, 12),
    ]);
    const branding = parseBranding(await getSetting(db, 'branding', DEFAULT_BRANDING));
    return { tenant, week, visibility, prompts, rivals, answers, gsc, branding };
  });
  if (!res.ok) return <><h1>Report</h1><div className="alert bad" role="alert">Could not load the report: {res.error}</div></>;
  const { tenant, week, visibility, prompts, rivals, answers, gsc, branding } = res.value;
  const providers = [...new Set(visibility.map((v) => v.provider))].sort();
  const all = series(visibility);
  const lines = [{ name: 'All assistants', points: all }, ...providers.map((p) => ({ name: PROVIDER_NAMES[p] ?? p, points: series(visibility, p) }))];
  const last = all.filter((p) => p.asked > 0).at(-1);
  const d = delta(all);
  const rows = [...new Set(prompts.map((p) => p.prompt))];
  const positions = prompts.filter((p) => p.position !== null).map((p) => p.position!);
  const avgPosition = positions.length ? (positions.reduce((a, b) => a + b, 0) / positions.length).toFixed(1) : null;
  return (
    <>
      <div className="row noprint" style={{ justifyContent: 'space-between' }}>
        {user.role === 'client' ? <span /> : <a className="small" href="/reports">← All reports</a>}
        <span className="row"><a className="btn secondary" href={`/reports/${id}/csv`}>Download CSV</a><PrintButton /></span>
      </div>
      <h1>{tenant.identity.name}: AI visibility</h1>
      <p className="muted">{week ? `Latest measurement: week of ${week}.` : 'Not measured yet. The first report appears after the next weekly run.'} Each question is asked to {providers.length ? providers.map((p) => PROVIDER_NAMES[p] ?? p).join(', ') : 'the connected assistants'}; an answer counts as a mention when it names the business or its website.</p>

      <div className="grid">
        <div className="card"><div className="stat">{last ? percent(last.mentioned) : 'n/a'}</div><div className="muted small">of answers mention the business {d !== null && <Badge tone={d > 0 ? 'ok' : d < 0 ? 'bad' : 'off'}>{d > 0 ? '+' : ''}{d} pts</Badge>}</div></div>
        <div className="card"><div className="stat">{last ? percent(last.cited) : 'n/a'}</div><div className="muted small">cite the website with a link</div></div>
        <div className="card"><div className="stat">{avgPosition ?? 'n/a'}</div><div className="muted small">average position when mentioned (1 is named first)</div></div>
        <div className="card"><div className="stat">{last?.asked ?? 0}</div><div className="muted small">answers measured</div></div>
      </div>

      <h2>Trend</h2>
      <div className="card"><TrendChart lines={lines} title="Share of AI answers that mention the business, by week" /></div>
      <details className="card noprint"><summary>Show the numbers</summary>
        <div className="tablewrap"><table><thead><tr><th>Week</th><th>Asked</th><th>Mentioned</th><th>Cited</th></tr></thead><tbody>
          {all.map((p) => <tr key={p.week}><td>{p.week}</td><td>{p.asked}</td><td>{percent(p.mentioned)}</td><td>{percent(p.cited)}</td></tr>)}
        </tbody></table></div>
      </details>

      {rows.length > 0 && (
        <>
          <h2>By question (latest week)</h2>
          <div className="card tablewrap"><table>
            <thead><tr><th>Question</th>{providers.map((p) => <th key={p}>{PROVIDER_NAMES[p] ?? p}</th>)}</tr></thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q}>
                  <td dir="auto">{q}</td>
                  {providers.map((p) => {
                    const r = prompts.find((x) => x.prompt === q && x.provider === p);
                    return <td key={p}>{!r ? <span className="muted">-</span> : r.error ? <Badge tone="warn">error</Badge> : r.mentioned ? <Badge tone="ok">mentioned{r.position ? ` #${r.position}` : ''}{r.cited ? ' + link' : ''}</Badge> : <Badge tone="off">not mentioned</Badge>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}

      {tenant.competitors.length > 0 && week && (
        <>
          <h2>Competitors named in the same answers</h2>
          {rivals.length === 0 ? <p className="muted">None of the tracked competitors were named.</p> : (
            <div className="card"><ul>{rivals.map((r) => <li key={r.name}>{r.name}: in {r.count} answer{r.count === 1 ? '' : 's'}</li>)}</ul></div>
          )}
        </>
      )}

      {gsc.length > 0 && (
        <>
          <h2>Google search (Search Console)</h2>
          <div className="card tablewrap"><table>
            <thead><tr><th>Week</th><th>Clicks</th><th>Impressions</th><th>Average position</th><th>Top query</th></tr></thead>
            <tbody>{gsc.map((w) => <tr key={w.week}><td>{w.week}</td><td>{w.clicks}</td><td>{w.impressions}</td><td>{w.avg_position ?? '-'}</td><td dir="auto">{w.top_queries[0]?.query ?? '-'}</td></tr>)}</tbody>
          </table></div>
        </>
      )}

      {answers.length > 0 && user.role !== 'client' && (
        <details className="card noprint"><summary>Sample answers</summary>
          {answers.map((a, i) => (
            <div key={i} className="rowform"><strong dir="auto">{a.prompt}</strong> <span className="muted small">{PROVIDER_NAMES[a.provider] ?? a.provider}</span>
              <p dir="auto" style={{ whiteSpace: 'pre-wrap' }}>{(a.answer ?? '').slice(0, 700)}{(a.answer ?? '').length > 700 ? '…' : ''}</p></div>
          ))}
        </details>
      )}
      {branding.reportFooter && <p className="muted small" style={{ marginTop: '2rem' }}>{branding.reportFooter}</p>}
    </>
  );
}