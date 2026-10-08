/** Decide, from an assistant's answer, whether a business was mentioned or cited, and where it ranked. */

export interface Brand {
  names: string[];
  domain: string;
}

export interface Rival {
  name: string;
  domain?: string;
}

export interface Analysis {
  mentioned: boolean;
  cited: boolean;
  /** 1 means the business was named first among all businesses (it and the rivals) the answer names. null when not mentioned. */
  position: number | null;
  competitors: string[];
  snippet: string | null;
}

const lower = (s: string) => s.toLowerCase();

/** Index of the first mention of a name or domain, or -1. Latin names must match whole words; Arabic and other scripts match as substrings. */
export function firstMention(text: string, term: string): number {
  const t = lower(term.trim());
  if (!t) return -1;
  const hay = lower(text);
  if (/^[\p{Script=Latin}\p{N}\s.&'-]+$/u.test(t)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u');
    const m = re.exec(hay);
    return m ? m.index : -1;
  }
  return hay.indexOf(t);
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

export const citesDomain = (citations: string[], domain: string) => {
  const d = domain.replace(/^www\./, '').toLowerCase();
  return citations.some((c) => {
    const h = hostOf(c);
    return h === d || h.endsWith(`.${d}`);
  });
};

function snippetAround(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf('.', index - 1) + 1);
  const dot = text.indexOf('.', index);
  const end = dot === -1 ? text.length : dot + 1;
  const s = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return s.length > 280 ? `${s.slice(0, 277)}...` : s;
}

export function analyzeAnswer(answer: string, citations: string[], brand: Brand, rivals: Rival[]): Analysis {
  const mentions = [...brand.names, brand.domain].map((n) => firstMention(answer, n)).filter((i) => i >= 0);
  const own = mentions.length ? Math.min(...mentions) : -1;
  const rivalHits = rivals
    .map((r) => ({ r, at: [r.name, r.domain ?? ''].map((n) => firstMention(answer, n)).filter((i) => i >= 0) }))
    .filter((x) => x.at.length > 0)
    .map((x) => ({ name: x.r.name, at: Math.min(...x.at) }));
  const ranked = [...(own >= 0 ? [{ name: '', at: own }] : []), ...rivalHits].sort((a, b) => a.at - b.at);
  return {
    mentioned: own >= 0,
    cited: citesDomain(citations, brand.domain),
    position: own >= 0 ? ranked.findIndex((x) => x.name === '' && x.at === own) + 1 : null,
    competitors: rivalHits.map((r) => r.name),
    snippet: own >= 0 ? snippetAround(answer, own) : null,
  };
}
