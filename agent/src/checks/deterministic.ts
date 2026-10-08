import { containment, extractNumbers, fleschReadingEase, jaccard, longestSharedRun, plainText, wordCount, type Article } from '@avp/content';
import { blogPosting, breadcrumbs, faqPage, person, validateJsonLd } from '@avp/seo';
import type { GlobalDefaults } from '@avp/runtime';
import type { TenantConfig } from '@avp/tenant-schema';
import type { CheckResult, Draft, ResearchPack } from '../types.ts';

const ok = (name: string, label: string, severity: CheckResult['severity'] = 'blocker'): CheckResult => ({ name, label, passed: true, severity });
const fail = (name: string, label: string, reason: string, severity: CheckResult['severity'] = 'blocker'): CheckResult => ({ name, label, passed: false, reason, severity });
const result = (name: string, label: string, problems: string[], severity: CheckResult['severity'] = 'blocker'): CheckResult =>
  problems.length === 0 ? ok(name, label, severity) : fail(name, label, problems.join(' '), severity);

export interface CheckInput {
  article: Article;
  lang: string;
  claims: Draft['claims'];
  pack: ResearchPack;
  tenant: TenantConfig;
  globals: GlobalDefaults;
  /** Articles already on the site in the same language. */
  existing: Array<{ slug: string; title: string; body: string }>;
  siteUrl: string;
  publisherUrl?: string;
}

const HEADING = /^(#{2,3})\s+(.+)$/gm;
const QUESTION_END = /[?؟]\s*$/;

/** Does a word look like the start of a sentence in this language (any letters at all)? Used for the opening check. */
function firstParagraph(body: string): string {
  for (const block of body.split(/\n\s*\n/)) {
    const t = block.trim();
    if (t && !t.startsWith('#') && !/^[-*]\s/.test(t) && !t.startsWith('|')) return t;
  }
  return '';
}

export function checkStructure(i: CheckInput): CheckResult {
  const problems: string[] = [];
  const { article } = i;
  const opening = wordCountOf(firstParagraph(article.body));
  if (opening < 12 || opening > 80) problems.push(`The opening paragraph is ${opening} words. It should answer the question directly in 2 to 3 sentences (about 15 to 80 words).`);
  const questionHeadings = [...article.body.matchAll(HEADING)].filter((m) => QUESTION_END.test(m[2]!)).length;
  if (questionHeadings < 2) problems.push(`Only ${questionHeadings} question-style heading(s). Use at least 2 H2 or H3 headings phrased as questions.`);
  if (!/^\s*([-*+]|\d+[.)])\s+\S/m.test(article.body) && !/^\s*\|.+\|\s*$/m.test(article.body)) problems.push('There is no list, step list or table.');
  if (article.takeaways.length < 3) problems.push(`There are ${article.takeaways.length} key takeaways. Give at least 3.`);
  if (article.faq.length < 3 || article.faq.length > 5) problems.push(`There are ${article.faq.length} FAQ items. Give 3 to 5.`);
  if (!/\]\(\/[^)\s]*\)/.test(article.body)) problems.push('There is no internal link to a service page or related article.');
  if (/<\/?[a-z][^>]*>/i.test(article.body)) problems.push('The body contains raw HTML. Use Markdown only.');
  if (/^#\s/m.test(article.body)) problems.push('The body contains a top-level heading. The page title is the only H1.');
  return result('structure', 'Structure (answer first, question headings, takeaways, FAQ, links)', problems);
}

const wordCountOf = (s: string) => wordCount(s);

export function checkLength(i: CheckInput): CheckResult {
  const { min, max } = i.tenant.agent.articleWords;
  const n = wordCount(i.article.body);
  // A 10% margin either side: the target is a guide, not a cliff.
  return n < Math.floor(min * 0.9) || n > Math.ceil(max * 1.1)
    ? fail('length', 'Length', `The article is ${n} words. The target is ${min} to ${max}.`)
    : ok('length', 'Length');
}

export function checkMeta(i: CheckInput): CheckResult {
  const p: string[] = [];
  const { article } = i;
  if (article.title.length > 70) p.push(`The title is ${article.title.length} characters (limit 70).`);
  if (article.metaTitle && article.metaTitle.length > 65) p.push(`The meta title is ${article.metaTitle.length} characters (limit 65).`);
  if (article.description.length < 50 || article.description.length > 170) p.push(`The meta description is ${article.description.length} characters (should be 50 to 170).`);
  return result('meta', 'Title and meta description', p);
}

export function checkSources(i: CheckInput): CheckResult {
  const p: string[] = [];
  const unique = new Map(i.article.sources.map((s) => [s.url, s]));
  if (unique.size < i.globals.minSources) p.push(`${unique.size} source(s) cited. At least ${i.globals.minSources} are required.`);
  for (const s of unique.values()) if (!s.date) p.push(`Source "${s.title}" has no date.`);
  const known = new Set(unique.keys());
  const orphan = i.claims.filter((c) => !known.has(c.sourceUrl));
  if (orphan.length) p.push(`${orphan.length} claim(s) point to a source that is not listed: "${orphan[0]!.text.slice(0, 60)}".`);
  if (i.claims.length === 0) p.push('The article lists no claims, so none can be checked against a source.');
  return result('sources', 'Sources cited, dated and tied to claims', p);
}

/** Numbers that are not years or list markers, found in the article text. */
function significantNumbers(i: CheckInput): string[] {
  const text = [i.article.body, ...i.article.takeaways, ...i.article.faq.map((f) => f.answer)].join('\n');
  return extractNumbers(text).filter((n) => {
    const digits = n.replace(/[^0-9]/g, '');
    if (/^(19|20)\d{2}$/.test(digits) && !/[%]|million|billion|thousand/i.test(n)) return false; // a year
    return digits.length > 0 && !(digits.length === 1 && !/%|x|k/i.test(n)); // a lone digit such as "3 steps" is counting, not a statistic
  });
}

export function checkNumbersCited(i: CheckInput): CheckResult {
  const claimText = i.claims.map((c) => c.text).join(' \n ');
  const uncited = significantNumbers(i).filter((n) => !claimText.includes(n) && !i.pack.facts.some((f) => f.claim.includes(n) || f.quote.includes(n)));
  return uncited.length
    ? fail('numbers-cited', 'Every statistic is tied to a cited claim', `These figures are not backed by a cited claim: ${uncited.slice(0, 5).join(', ')}.`)
    : ok('numbers-cited', 'Every statistic is tied to a cited claim');
}

export function checkBannedClaims(i: CheckInput): CheckResult {
  const banned = [...i.tenant.voice.bannedClaims, ...i.tenant.compliance.neverClaim].map((b) => b.toLowerCase());
  const haystack = [i.article.title, i.article.description, i.article.body, ...i.article.takeaways, ...i.article.faq.flatMap((f) => [f.question, f.answer])].join('\n').toLowerCase();
  const hits = banned.filter((b) => haystack.includes(b));
  return hits.length ? fail('banned-claims', 'No banned claims or guarantees', `Contains: ${hits.map((h) => `"${h}"`).join(', ')}.`) : ok('banned-claims', 'No banned claims or guarantees');
}

/** Similarity of two short titles by shared words, 0 to 1. */
export function titleSimilarity(a: string, b: string): number {
  const A = new Set(plainText(a).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
  const B = new Set(plainText(b).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

export function checkDuplicate(i: CheckInput): CheckResult {
  const limit = i.globals.maxDuplicateSimilarity;
  for (const other of i.existing) {
    if (other.slug === i.article.slug) return fail('duplicate', 'Not a duplicate of an existing article', `An article with the slug "${other.slug}" already exists.`);
    const body = jaccard(i.article.body, other.body);
    const title = titleSimilarity(i.article.title, other.title);
    if (body >= limit) return fail('duplicate', 'Not a duplicate of an existing article', `${Math.round(body * 100)}% of the text matches "${other.title}" (limit ${Math.round(limit * 100)}%).`);
    if (title >= 0.85) return fail('duplicate', 'Not a duplicate of an existing article', `The title is nearly the same as "${other.title}", so the two would compete for the same searches.`);
  }
  return ok('duplicate', 'Not a duplicate of an existing article');
}

export function checkOriginality(i: CheckInput): CheckResult {
  const quotes = i.pack.facts.map((f) => f.quote).join('\n');
  const reference = `${i.pack.notes}\n${quotes}`;
  const run = longestSharedRun(i.article.body, reference);
  const overlap = containment(i.article.body, reference, 5);
  if (run >= 15) return fail('originality', 'Original wording, not copied from sources', `A passage of ${run} words in a row matches the research material. Rewrite it in new words.`);
  if (overlap > 0.3) return fail('originality', 'Original wording, not copied from sources', `${Math.round(overlap * 100)}% of the article closely follows the research notes.`);
  return ok('originality', 'Original wording, not copied from sources');
}

export function checkReadability(i: CheckInput): CheckResult {
  if (i.lang.split('-')[0] !== 'en') return { name: 'readability', label: 'Readability', passed: true, reason: `Not measured for ${i.lang}.`, severity: 'advisory' };
  const score = fleschReadingEase(i.article.body);
  return score < i.globals.minReadability
    ? fail('readability', 'Readability', `Reading ease is ${score}. It should be at least ${i.globals.minReadability}. Use shorter sentences and simpler words.`)
    : { ...ok('readability', 'Readability'), reason: `Reading ease ${score}.` };
}

export function checkSchema(i: CheckInput): CheckResult {
  const t = i.tenant;
  const url = `${i.siteUrl}/blog/${i.article.slug}/`;
  const nodes = [
    blogPosting({
      headline: i.article.title,
      description: i.article.description,
      url,
      datePublished: i.article.datePublished,
      dateModified: i.article.dateModified,
      inLanguage: i.lang,
      authorName: t.author.name,
      publisherName: t.identity.name,
    }),
    faqPage(i.article.faq),
    breadcrumbs([{ name: 'Home', url: i.siteUrl + '/' }, { name: i.article.title, url }]),
    person({ name: t.author.name }),
  ];
  return result('schema', 'Structured data (BlogPosting and FAQPage) is valid', nodes.flatMap(validateJsonLd));
}

export function checkLanguage(i: CheckInput): CheckResult {
  const letters = plainText(i.article.body).match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return fail('language', 'Written in the right language', 'The article has no text.');
  const base = i.lang.split('-')[0];
  const arabic = letters.filter((c) => /\p{Script=Arabic}/u.test(c)).length / letters.length;
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length / letters.length;
  if (base === 'ar' && arabic < 0.6) return fail('language', 'Written in the right language', `Only ${Math.round(arabic * 100)}% of the letters are Arabic.`);
  if (base === 'en' && latin < 0.9) return fail('language', 'Written in the right language', `Only ${Math.round(latin * 100)}% of the letters are Latin.`);
  return ok('language', 'Written in the right language');
}

export function runDeterministicChecks(i: CheckInput): CheckResult[] {
  return [checkStructure, checkLength, checkMeta, checkSources, checkNumbersCited, checkBannedClaims, checkDuplicate, checkOriginality, checkReadability, checkSchema, checkLanguage].map((c) => c(i));
}

/** Risk score 0 to 100: how much human attention an article deserves. Higher means more. */
export function riskScore(results: Array<Pick<CheckResult, 'name' | 'passed' | 'severity'>>): number {
  const weight: Record<string, number> = {
    'claims-verified': 40, 'banned-claims': 35, defamation: 30, 'numbers-cited': 25, duplicate: 20, originality: 20, sources: 20, voice: 15,
  };
  let risk = 0;
  for (const r of results) {
    if (r.passed) continue;
    risk += r.severity === 'advisory' ? 5 : (weight[r.name] ?? 10);
  }
  return Math.min(100, risk);
}

export const gatesPassed = (results: Array<Pick<CheckResult, 'passed' | 'severity'>>) => results.every((r) => r.passed || r.severity === 'advisory');
