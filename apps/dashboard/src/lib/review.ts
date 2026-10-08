import { parseArticle, lineDiff, type Article } from '@avp/content';
import { decodeReview, LABEL, type ReviewData } from '@avp/agent/review';
import type { GitHubClient, PullSummary } from '@avp/github';

export interface Draft {
  pr: PullSummary;
  review: ReviewData;
}

export interface DraftLang {
  lang: string;
  path: string;
  article: Article;
  /** Changes since the previous revision on the branch, if there is one. */
  diff: ReturnType<typeof lineDiff> | null;
}

export interface DraftDetail extends Draft {
  langs: DraftLang[];
  comments: Array<{ author: string; body: string; createdAt: string }>;
}

/** Open article drafts, newest first. Pull requests without agent review data are not shown. */
export async function loadDrafts(gh: GitHubClient): Promise<Draft[]> {
  const pulls = await gh.listPulls({ label: LABEL.article, state: 'open' });
  const out: Draft[] = [];
  for (const pr of pulls) {
    const review = decodeReview(pr.body);
    if (review) out.push({ pr, review });
  }
  return out.sort((a, b) => b.pr.createdAt.localeCompare(a.pr.createdAt));
}

export async function loadDraft(gh: GitHubClient, number: number): Promise<DraftDetail | null> {
  let pr: PullSummary;
  try {
    pr = await gh.getPull(number);
  } catch {
    return null;
  }
  const review = decodeReview(pr.body);
  if (!review || !pr.labels.includes(LABEL.article)) return null;
  const langs: DraftLang[] = [];
  for (const lang of review.languages) {
    const path = `tenants/${review.tenantId}/articles/${lang}/${review.slug}.md`;
    const file = await gh.getFile(path, pr.branch);
    if (!file) continue;
    const article = parseArticle(file.content);
    let diff: DraftLang['diff'] = null;
    if (review.revision > 0 || pr.state === 'open') {
      const history = await gh.history(path, 5, pr.branch).catch(() => []);
      if (history.length >= 2) {
        const before = await gh.getFile(path, history[1]!.sha).catch(() => null);
        if (before) diff = lineDiff(parseArticle(before.content).body, article.body);
      }
    }
    langs.push({ lang, path, article, diff });
  }
  const comments = (await gh.comments(number).catch(() => [])).map(({ author, body, createdAt }) => ({ author, body, createdAt }));
  return { pr, review, langs, comments };
}
