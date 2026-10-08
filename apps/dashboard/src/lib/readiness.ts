import { validateTenant, type Issue } from '@avp/tenant-schema';

/** Which editor tab fixes an issue at a config path. */
export function tabForPath(path: string): string {
  const head = path.split(/[.[]/)[0]!;
  const map: Record<string, string> = {
    identity: 'identity', languages: 'languages', profile: 'business', personas: 'audience', faq: 'faq',
    trackerPrompts: 'strategy', pillars: 'strategy', competitors: 'strategy', keywords: 'strategy', questionTypes: 'strategy',
    agent: 'controls', status: 'controls', voice: 'voice', compliance: 'voice', author: 'author', legal: 'legal',
    integrations: 'integrations', site: 'integrations', crawlers: 'integrations',
  };
  return map[head] ?? 'advanced';
}

export interface Readiness {
  errors: Issue[];
  /** Launch-readiness notes, computed as if the business were active. */
  warnings: Issue[];
  /** Extra things worth doing that are not validation rules. */
  suggestions: Array<{ text: string; tab: string }>;
}

export function readiness(raw: any): Readiness {
  const r = validateTenant({ ...(raw ?? {}), status: 'active' });
  const suggestions: Readiness['suggestions'] = [];
  if (!raw?.integrations?.leadForm) suggestions.push({ text: 'No lead form destination is set, so the contact page cannot collect enquiries.', tab: 'integrations' });
  if (!raw?.legal?.privacy) suggestions.push({ text: 'No privacy policy text, so no privacy page is published.', tab: 'legal' });
  if (!raw?.personas?.length) suggestions.push({ text: 'Add at least one persona with pain points so the agent knows what to write about.', tab: 'audience' });
  if (!raw?.pillars?.length) suggestions.push({ text: 'Add content pillars to focus the topics the agent picks.', tab: 'strategy' });
  if (!raw?.competitors?.length) suggestions.push({ text: 'Add competitors so the tracker can compare visibility.', tab: 'strategy' });
  return { errors: r.errors, warnings: r.warnings, suggestions };
}
