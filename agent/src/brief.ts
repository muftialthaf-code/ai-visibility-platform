import type { TenantConfig } from '@avp/tenant-schema';

const pick = (v: Record<string, string> | undefined, lang: string, fallback: string) => v?.[lang] ?? v?.[fallback] ?? Object.values(v ?? {})[0] ?? '';
const list = (v: Record<string, string[]> | undefined, lang: string, fallback: string) => v?.[lang] ?? v?.[fallback] ?? Object.values(v ?? {})[0] ?? [];

/** A plain-text description of the business, handed to the model so it writes for this business and no other. */
export function businessBrief(t: TenantConfig, lang: string): string {
  const d = t.languages.default;
  const lines = [
    `Business: ${t.identity.name} (${t.identity.domain})`,
    `What it does: ${pick(t.profile.description, lang, d)}`,
    `Who it serves: ${pick(t.profile.audience, lang, d)}`,
  ];
  const diffs = list(t.profile.differentiators, lang, d);
  if (diffs.length) lines.push(`What sets it apart: ${diffs.join('; ')}`);
  if (t.profile.offerings.length) lines.push(`Services: ${t.profile.offerings.map((o) => `${pick(o.name, lang, d)} (/services/${o.id}/)`).join('; ')}`);
  if (t.personas.length) lines.push(`Audience groups: ${t.personas.map((p) => pick(p.name, lang, d)).join('; ')}`);
  return lines.join('\n');
}

export function voiceBrief(t: TenantConfig, lang: string): string {
  const d = t.languages.default;
  const lines = [`Tone: ${pick(t.voice.tone, lang, d)}`];
  if (t.voice.dos.length) lines.push(`Do: ${t.voice.dos.join('; ')}`);
  if (t.voice.donts.length) lines.push(`Do not: ${t.voice.donts.join('; ')}`);
  const banned = [...t.voice.bannedClaims, ...t.compliance.neverClaim];
  if (banned.length) lines.push(`Never say or imply: ${banned.join('; ')}`);
  if (t.compliance.notes) lines.push(`Compliance notes: ${t.compliance.notes}`);
  return lines.join('\n');
}

export const LANGUAGE_NAMES: Record<string, string> = { en: 'English', ar: 'Arabic' };
export const languageName = (code: string) => LANGUAGE_NAMES[code.split('-')[0]!] ?? code;

/** Languages an article is written in: the configured list, or the default language alone. */
export const articleLanguages = (t: TenantConfig): string[] => (t.agent.articleLanguages.length ? t.agent.articleLanguages : [t.languages.default]);
