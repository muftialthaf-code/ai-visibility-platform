export type { ReviewData } from './types.ts';
import type { ReviewData } from './types.ts';

const PATTERN = /<!--\s*avp-review:([A-Za-z0-9+/=]+)\s*-->/;

/** The review data travels inside the pull request body as an HTML comment, so the dashboard needs nothing but GitHub. */
export function encodeReview(data: ReviewData): string {
  return `<!-- avp-review:${Buffer.from(JSON.stringify(data), 'utf8').toString('base64')} -->`;
}

export function decodeReview(body: string): ReviewData | null {
  const m = PATTERN.exec(body);
  if (!m) return null;
  try {
    const data = JSON.parse(Buffer.from(m[1]!, 'base64').toString('utf8'));
    return data && data.version === 1 && typeof data.tenantId === 'string' ? (data as ReviewData) : null;
  } catch {
    return null;
  }
}

export const LABEL = {
  article: 'article',
  tenant: (id: string) => `tenant:${id}`,
  passed: 'gates:passed',
  failed: 'gates:failed',
  changes: 'changes-requested',
} as const;

export function labelsFor(data: Pick<ReviewData, 'tenantId' | 'gatesPassed'>, extra: string[] = []): string[] {
  return [LABEL.article, LABEL.tenant(data.tenantId), data.gatesPassed ? LABEL.passed : LABEL.failed, ...extra];
}

/** Human-readable pull request description, followed by the machine-readable block. */
export function renderPullBody(data: ReviewData, urls: string[]): string {
  const failing = data.checks.filter((c) => !c.passed);
  const lines = [
    `**Topic:** ${data.topic.topic}`,
    `**Question:** ${data.topic.question}`,
    `**Languages:** ${data.languages.join(', ')}`,
    `**Risk score:** ${data.risk}/100 · **Cost:** $${data.cost.usd.toFixed(2)} · **Revision:** ${data.revision}`,
    '',
    data.gatesPassed ? 'All required checks passed.' : `Held for review. ${failing.filter((c) => c.severity === 'blocker').length} required check(s) failed:`,
    ...failing.map((c) => `- ${c.lang}: ${c.label}${c.reason ? ` — ${c.reason}` : ''}`),
    '',
    'Sources:',
    ...data.sources.map((s) => `- [${s.title}](${s.url})${s.date ? ` (${s.date})` : ''}`),
    '',
    ...urls.map((u) => `Will be live at ${u}`),
    '',
    'Review this in the dashboard. Merging this pull request publishes the article.',
    '',
    encodeReview(data),
  ];
  return lines.join('\n');
}
