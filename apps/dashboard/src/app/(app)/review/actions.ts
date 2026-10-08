'use server';
import { articlePath, parseArticle, serializeArticle } from '@avp/content';
import { addReviewEvent, getSetting, rejectTopicByTitle, schedulePublish } from '@avp/db';
import { gatesPassed, riskScore, runDeterministicChecks } from '@avp/agent/checks';
import { LABEL, labelsFor, renderPullBody, type ReviewData } from '@avp/agent/review';
import { existingArticles } from '@avp/agent/site-content';
import { DEFAULT_GLOBALS, parseGlobals } from '@avp/runtime';
import { getTenant } from '@avp/tenant-ops';
import type { FormState } from '@/components/ActionForm';
import { audit, requireUser } from '@/lib/auth';
import { loadDraft } from '@/lib/review';
import { getDb, getGitHub, getStore } from '@/lib/services';

const text = (d: FormData, k: string) => String(d.get(k) ?? '').trim();
const fail = (e: unknown): FormState => ({ error: e instanceof Error ? e.message : 'Something went wrong.' });

/** Load the draft and check the user may act on its business. Redirects away when they may not. */
async function open(data: FormData) {
  const number = Number(text(data, 'pr'));
  if (!Number.isInteger(number) || number < 1) throw new Error('Unknown draft.');
  const gh = getGitHub();
  const draft = await loadDraft(gh, number);
  if (!draft) throw new Error('That draft was not found. It may already be published or closed.');
  if (draft.pr.state !== 'open') throw new Error('That draft is already closed.');
  const user = await requireUser('review:act', draft.review.tenantId);
  return { gh, draft, user };
}

export async function approveAction(_prev: FormState, data: FormData): Promise<FormState> {
  try {
    const { gh, draft, user } = await open(data);
    if (!draft.review.gatesPassed && text(data, 'override') !== 'on') {
      return { error: 'Some required checks failed. Tick the box to publish anyway, or request changes.' };
    }
    await gh.mergePull(draft.pr.number, `Publish: ${draft.langs[0]?.article.title ?? draft.pr.title}`);
    await addReviewEvent(await getDb(), { tenantId: draft.review.tenantId, prNumber: draft.pr.number, action: draft.review.gatesPassed ? 'approved' : 'approved despite failed checks', actor: user.email });
    await audit(user, 'review.approve', draft.review.tenantId, { pr: draft.pr.number, override: !draft.review.gatesPassed });
    return { ok: 'Published. The site deploys in a few minutes.', redirect: `/review?notice=${encodeURIComponent('Published. The site deploys in a few minutes.')}` };
  } catch (e) {
    return fail(e);
  }
}

/** Approve several drafts at once. Only drafts whose checks all passed are accepted. */
export async function bulkApproveAction(_prev: FormState, data: FormData): Promise<FormState> {
  try {
    const numbers = data.getAll('pr').map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
    if (numbers.length === 0) return { error: 'Choose at least one draft.' };
    const gh = getGitHub();
    let done = 0;
    const skipped: string[] = [];
    for (const n of numbers) {
      const draft = await loadDraft(gh, n);
      if (!draft || draft.pr.state !== 'open') { skipped.push(`#${n} is not open`); continue; }
      const user = await requireUser('review:act', draft.review.tenantId);
      if (!draft.review.gatesPassed) { skipped.push(`#${n} has failed checks`); continue; }
      await gh.mergePull(n, `Publish: ${draft.langs[0]?.article.title ?? draft.pr.title}`);
      await addReviewEvent(await getDb(), { tenantId: draft.review.tenantId, prNumber: n, action: 'approved (bulk)', actor: user.email });
      await audit(user, 'review.approve', draft.review.tenantId, { pr: n, bulk: true });
      done++;
    }
    const message = `Published ${done} draft(s).${skipped.length ? ` Skipped: ${skipped.join('; ')}.` : ''}`;
    return { ok: message, redirect: `/review?notice=${encodeURIComponent(message)}` };
  } catch (e) {
    return fail(e);
  }
}

export async function rejectAction(_prev: FormState, data: FormData): Promise<FormState> {
  try {
    const { gh, draft, user } = await open(data);
    const reason = text(data, 'reason');
    if (!reason) return { error: 'Say why, so the agent does not suggest something similar again.' };
    await gh.closePull(draft.pr.number, `Rejected by ${user.email}: ${reason}`);
    const db = await getDb();
    await rejectTopicByTitle(db, draft.review.tenantId, draft.review.topic.topic, reason);
    await addReviewEvent(db, { tenantId: draft.review.tenantId, prNumber: draft.pr.number, action: 'rejected', actor: user.email, note: reason });
    await audit(user, 'review.reject', draft.review.tenantId, { pr: draft.pr.number });
    return { ok: 'Rejected.', redirect: `/review?notice=${encodeURIComponent('Rejected. The agent will avoid similar topics.')}` };
  } catch (e) {
    return fail(e);
  }
}

export async function requestChangesAction(_prev: FormState, data: FormData): Promise<FormState> {
  try {
    const { gh, draft, user } = await open(data);
    const instructions = text(data, 'instructions');
    if (instructions.length < 5) return { error: 'Say what should change.' };
    if (instructions.length > 2000) return { error: 'Keep the instructions under 2,000 characters.' };
    await gh.comment(draft.pr.number, `Changes requested by ${user.email}:\n\n${instructions}`);
    await gh.setLabels(draft.pr.number, [...new Set([...draft.pr.labels, LABEL.changes])]);
    await gh.dispatchWorkflow('agent-revise.yml', { tenant: draft.review.tenantId, pr: String(draft.pr.number), instructions });
    await addReviewEvent(await getDb(), { tenantId: draft.review.tenantId, prNumber: draft.pr.number, action: 'changes requested', actor: user.email, note: instructions.slice(0, 500) });
    await audit(user, 'review.request-changes', draft.review.tenantId, { pr: draft.pr.number });
    return { ok: 'Sent. The agent is rewriting the draft; this page will show the new version in a few minutes.', reload: true };
  } catch (e) {
    return fail(e);
  }
}

export async function scheduleAction(_prev: FormState, data: FormData): Promise<FormState> {
  try {
    const { draft, user } = await open(data);
    const at = new Date(text(data, 'publishAt'));
    if (Number.isNaN(at.getTime())) return { error: 'Choose a date and time (UTC).' };
    if (at.getTime() < Date.now() + 5 * 60_000) return { error: 'Choose a time at least 5 minutes from now.' };
    if (!draft.review.gatesPassed && text(data, 'override') !== 'on') return { error: 'Some required checks failed. Tick the box to schedule anyway.' };
    const db = await getDb();
    await schedulePublish(db, { tenantId: draft.review.tenantId, prNumber: draft.pr.number, publishAt: at, createdBy: user.email });
    await addReviewEvent(db, { tenantId: draft.review.tenantId, prNumber: draft.pr.number, action: 'scheduled', actor: user.email, note: at.toISOString() });
    await audit(user, 'review.schedule', draft.review.tenantId, { pr: draft.pr.number, at: at.toISOString() });
    return { ok: `Scheduled for ${at.toISOString().replace('T', ' ').slice(0, 16)} UTC. It publishes within the hour after that.`, reload: true };
  } catch (e) {
    return fail(e);
  }
}

/** Save a reviewer's own edits to the article files on the draft branch, then re-run the automatic checks. */
export async function editAction(_prev: FormState, data: FormData): Promise<FormState> {
  try {
    const { gh, draft, user } = await open(data);
    const today = new Date().toISOString().slice(0, 10);
    const changes = [];
    const edited: Array<{ lang: string; article: ReturnType<typeof parseArticle> }> = [];
    for (const l of draft.langs) {
      const next = {
        ...l.article,
        title: text(data, `title:${l.lang}`) || l.article.title,
        description: text(data, `description:${l.lang}`) || l.article.description,
        body: (String(data.get(`body:${l.lang}`) ?? '').trim() || l.article.body.trim()) + '\n',
        dateModified: today,
      };
      edited.push({ lang: l.lang, article: next });
      changes.push({ path: articlePath(draft.review.tenantId, l.lang, draft.review.slug), content: serializeArticle(next) });
    }
    const db = await getDb();
    const store = getStore(user.email);
    const tenant = await getTenant(store, draft.review.tenantId);
    const globals = parseGlobals(await getSetting(db, 'defaults', DEFAULT_GLOBALS));
    const keep = draft.review.checks.filter((c) => ['voice', 'defamation', 'compliance', 'claims-verified', 'editorial'].includes(c.name));
    const fresh: ReviewData['checks'] = [];
    for (const e of edited) {
      const existing = await existingArticles(store, tenant.id, e.lang);
      const claims = draft.review.claims?.[e.lang] ?? [];
      const pack = { notes: claims.map((c) => c.text).join('\n'), facts: claims.map((c) => ({ claim: c.text, sourceUrl: c.sourceUrl, quote: c.text })), sources: draft.review.sources };
      for (const c of runDeterministicChecks({ article: e.article, lang: e.lang, claims, pack, tenant, globals, existing, siteUrl: `https://${tenant.identity.domain}` })) fresh.push({ ...c, lang: e.lang });
    }
    const checks = [...fresh, ...keep];
    const review: ReviewData = { ...draft.review, checks, risk: riskScore(checks), gatesPassed: gatesPassed(checks) };
    await gh.commitFiles(changes, `Edit draft by ${user.email}`, draft.pr.branch);
    await gh.updatePull(draft.pr.number, { body: renderPullBody(review, edited.map((e) => `https://${tenant.identity.domain}${e.lang === tenant.languages.default ? '' : `/${e.lang}`}/blog/${draft.review.slug}/`)) });
    await gh.setLabels(draft.pr.number, labelsFor(review, draft.pr.labels.filter((l) => l === LABEL.changes)));
    await addReviewEvent(db, { tenantId: tenant.id, prNumber: draft.pr.number, action: 'edited', actor: user.email });
    await audit(user, 'review.edit', tenant.id, { pr: draft.pr.number });
    return { ok: review.gatesPassed ? 'Saved. All required checks pass.' : 'Saved. Some required checks fail.', reload: true };
  } catch (e) {
    return fail(e);
  }
}

/** Start the article agent for one business now, instead of waiting for the daily run. */
export async function runNowAction(_prev: FormState, data: FormData): Promise<FormState> {
  const tenant = text(data, 'tenant');
  try {
    const user = await requireUser('agent:control', tenant);
    await getGitHub().dispatchWorkflow('agent-daily.yml', { tenant, dry_run: text(data, 'dry') === 'on' ? 'true' : 'false' });
    await audit(user, 'agent.run-now', tenant);
    return { ok: 'Started. The new draft appears in the review queue in a few minutes.', reload: true };
  } catch (e) {
    return fail(e);
  }
}
