/** AI crawlers that robots.txt allows by default (per-tenant overridable). */
export const AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-User',
  'PerplexityBot',
  'Google-Extended',
  'Applebot-Extended',
] as const;

export interface RobotsInput {
  siteUrl: string;
  /** Master switch for the AI crawler list. */
  allowAI?: boolean;
  /** Per-crawler override, e.g. { GPTBot: false }. */
  overrides?: Record<string, boolean>;
  /** Block everything, used for staging builds. */
  blockAll?: boolean;
}

export function buildRobotsTxt(i: RobotsInput): string {
  if (i.blockAll) return 'User-agent: *\nDisallow: /\n';

  const allowAI = i.allowAI ?? true;
  const overrides = i.overrides ?? {};
  const lines: string[] = ['User-agent: *', 'Allow: /', ''];

  const names = new Set<string>([...AI_CRAWLERS, ...Object.keys(overrides)]);
  for (const name of names) {
    const allowed = name in overrides ? overrides[name] : allowAI;
    lines.push(`User-agent: ${name}`, allowed ? 'Allow: /' : 'Disallow: /', '');
  }

  lines.push(`Sitemap: ${i.siteUrl.replace(/\/$/, '')}/sitemap.xml`);
  return lines.join('\n') + '\n';
}
