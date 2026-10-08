import { renderMarkdownSafe } from '@avp/content';
import { listReviewEvents, listScheduled } from '@avp/db';
import { Badge, ago, money, when } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { loadDraft } from '@/lib/review';
import { getDb, getGitHub, safe } from '@/lib/services';
import { ApproveForm, ChangesForm, EditForm, RejectForm, ScheduleForm } from './Controls';

export default async function DraftPage({ params }: { params: Promise<{ pr: string }> }) {
  await requireUser('review:read');
  const { pr } = await params;
  const number = Number(pr);
  const back = <p className="small"><a href="/review">← Review queue</a></p>;
  if (!Number.isInteger(number) || number < 1) return <>{back}<div className="card">That draft does not exist.</div></>;
  const res = await safe(async () => ({ draft: await loadDraft(getGitHub(), number), db: await getDb() }));
  if (!res.ok) return <>{back}<div className="alert bad" role="alert">Could not load the draft: {res.error}</div></>;
  const { draft, db } = res.value;
  if (!draft) return <>{back}<div className="card">This draft is no longer in the queue. It may have been published, rejected or replaced. <a href="/review">Back to the queue</a>.</div></>;
  const user = await requireUser('review:read');
  const act = can(user, 'review:act', draft.review.tenantId);
  const open = draft.pr.state === 'open';
  const [events, scheduled] = await Promise.all([listReviewEvents(db, { tenantId: draft.review.tenantId, prNumber: number, limit: 20 }), listScheduled(db, { tenantId: draft.review.tenantId, pendingOnly: true })]);
  const pending = scheduled.find((s) => s.pr_number === number);
  const first = draft.langs[0];
  const failed = draft.review.checks.filter((c) => !c.passed);

  return (
    <>
      {back}
      <h1>{first?.article.title ?? draft.pr.title}</h1>
      <p>
        <Badge tone={draft.review.gatesPassed ? 'ok' : 'bad'}>{draft.review.gatesPassed ? 'all required checks passed' : 'held: a required check failed'}</Badge>{' '}
        {!open && <Badge tone="off">{draft.pr.merged ? 'published' : 'closed'}</Badge>}{' '}
        <span className="muted">{draft.review.tenantId} · risk {draft.review.risk}/100 · revision {draft.review.revision} · {money(draft.review.cost.usd)} · opened {ago(draft.pr.createdAt)}</span>
      </p>
      {pending && <div className="alert ok" role="status">Scheduled to publish at {when(pending.publish_at)}.</div>}
      {draft.pr.labels.includes('changes-requested') && <div className="alert" role="status">Changes were requested. The agent is rewriting this draft.</div>}

      <div className="card">
        <strong>Topic</strong>
        <p>{draft.review.topic.topic}</p>
        <p className="muted small">Question answered: {draft.review.topic.question}</p>
      </div>

      <h2>Checks</h2>
      <div className="card tablewrap"><table><tbody>
        {draft.review.checks.map((c, i) => (
          <tr key={i}>
            <td>{c.label}</td><td className="muted">{c.lang}</td>
            <td><Badge tone={c.passed ? 'ok' : c.severity === 'advisory' ? 'warn' : 'bad'}>{c.passed ? 'passed' : c.severity === 'advisory' ? 'note' : 'failed'}</Badge></td>
            <td className="muted">{c.reason}</td>
          </tr>
        ))}
      </tbody></table></div>
      {failed.length > 0 && <p className="muted small">{failed.filter((c) => c.severity === 'blocker').length} required check(s) failed. You can edit the article, ask the agent to rewrite it, or publish anyway.</p>}

      {draft.langs.map((l) => (
        <section key={l.lang} aria-label={`Article in ${l.lang}`}>
          <h2>Preview ({l.lang})</h2>
          <div className="card">
            <div className="muted small">Search result preview</div>
            <div style={{ color: 'var(--brand)', fontWeight: 600 }} dir="auto">{l.article.metaTitle ?? l.article.title}</div>
            <div className="muted small">/{l.lang === 'en' ? '' : `${l.lang}/`}blog/{l.article.slug}/</div>
            <div dir="auto">{l.article.description}</div>
          </div>
          <div className="card" dir="auto">
            <h3>{l.article.title}</h3>
            {l.article.takeaways.length > 0 && <><strong>Key takeaways</strong><ul>{l.article.takeaways.map((t, i) => <li key={i}>{t}</li>)}</ul></>}
            {/* renderMarkdownSafe escapes raw HTML and only allows http, https, mailto and relative links. */}
            <div dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(l.article.body) }} />
            {l.article.faq.length > 0 && <><h3>FAQ</h3>{l.article.faq.map((f, i) => <div key={i}><strong>{f.question}</strong><p>{f.answer}</p></div>)}</>}
          </div>
          {l.diff && l.diff.some((d) => d.type !== 'same') && (
            <details className="card">
              <summary>Changes since the previous revision ({l.lang})</summary>
              <pre>{l.diff.filter((d) => d.type !== 'same').map((d) => `${d.type === 'add' ? '+ ' : '- '}${d.text}`).join('\n')}</pre>
            </details>
          )}
        </section>
      ))}

      <h2>Sources</h2>
      <ul>{draft.review.sources.map((s, i) => <li key={i}><a href={s.url} rel="noopener noreferrer nofollow">{s.title}</a>{s.date ? <span className="muted"> · {s.date}</span> : null}</li>)}</ul>

      {act && open && (
        <>
          <h2>Decide</h2>
          <div className="grid">
            <div className="card"><h3>Publish</h3><ApproveForm pr={number} passed={draft.review.gatesPassed} /></div>
            <div className="card"><h3>Publish later</h3><ScheduleForm pr={number} passed={draft.review.gatesPassed} /></div>
            <div className="card"><h3>Request changes</h3><ChangesForm pr={number} /></div>
            <div className="card"><h3>Reject</h3><RejectForm pr={number} /></div>
          </div>
          <details className="card"><summary>Edit the article yourself</summary>
            <EditForm pr={number} langs={draft.langs.map((l) => ({ lang: l.lang, title: l.article.title, description: l.article.description, body: l.article.body }))} />
          </details>
        </>
      )}
      {!act && open && <p className="muted">You can read this draft but not act on it.</p>}

      <h2>History</h2>
      {events.length === 0 && draft.comments.length === 0 ? <p className="muted">Nothing yet.</p> : (
        <div className="card tablewrap"><table><tbody>
          {events.map((e) => <tr key={e.id}><td>{when(e.at)}</td><td>{e.action}</td><td>{e.actor}</td><td className="muted">{e.note}</td></tr>)}
        </tbody></table></div>
      )}
      <p className="muted small"><a href={draft.pr.url} rel="noopener noreferrer">Open the pull request on GitHub</a></p>
    </>
  );
}
