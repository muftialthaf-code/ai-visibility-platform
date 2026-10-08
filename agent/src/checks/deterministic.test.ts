import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOBALS } from '@avp/runtime';
import { validateTenant } from '@avp/tenant-schema';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkBannedClaims, checkDuplicate, checkLanguage, checkLength, checkNumbersCited, checkOriginality, checkSources, checkStructure, gatesPassed, riskScore, titleSimilarity, type CheckInput } from './deterministic.ts';

const tenant = validateTenant(JSON.parse(readFileSync(fileURLToPath(new URL('../../../tenants/_template/tenant.json', import.meta.url)), 'utf8'))).tenant!;
const body = (n: number) => Array.from({ length: n }, (_, i) => `Word${i % 7}`).join(' ');
const good = (): CheckInput => ({
  article: {
    title: 'A clear title', description: 'A description that is long enough to count as a real meta description.', slug: 'a-clear-title',
    datePublished: '2026-10-08', dateModified: '2026-10-08', takeaways: ['a', 'b', 'c'],
    faq: [1, 2, 3].map((n) => ({ question: `Q${n}?`, answer: 'An answer.' })),
    sources: [{ title: 'One', url: 'https://a.example/1', date: '2026-09-01' }, { title: 'Two', url: 'https://a.example/2', date: '2026-09-02' }],
    body: `Here is the short answer to the question in two plain sentences. It stays direct and simple.\n\n## What is it?\ntext\n\n## How does it work?\n- one\n- two\n\nSee [services](/services/).\n\n${body(300)}\n`,
  },
  lang: 'en',
  claims: [{ text: 'A claim', sourceUrl: 'https://a.example/1' }],
  pack: { notes: 'notes', facts: [{ claim: 'A claim', sourceUrl: 'https://a.example/1', quote: 'a quote about it' }], sources: [] },
  tenant: { ...tenant, agent: { ...tenant.agent, articleWords: { min: 100, max: 400 } } },
  globals: DEFAULT_GLOBALS,
  existing: [],
  siteUrl: 'https://x.example',
});

describe('deterministic checks', () => {
  it('accepts a well-formed article', () => {
    const i = good();
    for (const c of [checkStructure, checkLength, checkSources, checkNumbersCited, checkBannedClaims, checkDuplicate, checkLanguage]) expect(c(i), c.name).toMatchObject({ passed: true });
  });

  it('flags a missing internal link, too few question headings, and raw HTML', () => {
    const i = good();
    i.article.body = i.article.body.replace('[services](/services/)', 'services').replace(/\?/g, '.') + '\n<div>x</div>';
    const r = checkStructure(i);
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('internal link');
    expect(r.reason).toContain('question-style');
    expect(r.reason).toContain('raw HTML');
  });

  it('fails length outside the range with a margin', () => {
    const i = good();
    i.article.body = `${i.article.body}${body(2000)}`;
    expect(checkLength(i).passed).toBe(false);
  });

  it('needs enough dated sources and claims that point at listed sources', () => {
    const i = good();
    i.article.sources = [i.article.sources[0]!];
    expect(checkSources(i).reason).toContain('At least 2');
    i.article.sources = good().article.sources;
    i.claims = [{ text: 'Orphan', sourceUrl: 'https://other.example' }];
    expect(checkSources(i).reason).toContain('not listed');
  });

  it('flags statistics that no claim backs, but not years or counting', () => {
    const i = good();
    i.article.body += '\nPrices rose 45% last year. Follow these 3 steps in 2026.\n';
    const r = checkNumbersCited(i);
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('45%');
    expect(r.reason).not.toContain('2026');
    i.claims.push({ text: 'Prices rose 45% last year', sourceUrl: 'https://a.example/1' });
    expect(checkNumbersCited(i).passed).toBe(true);
  });

  it('blocks banned claims and near-duplicates and copied passages', () => {
    const i = good();
    i.tenant = { ...i.tenant, voice: { ...i.tenant.voice, bannedClaims: ['guaranteed results'] } };
    i.article.body += '\nWe offer Guaranteed Results.';
    expect(checkBannedClaims(i).passed).toBe(false);
    const j = good();
    j.existing = [{ slug: 'old', title: 'A clear title', body: j.article.body }];
    expect(checkDuplicate(j).passed).toBe(false);
    const k = good();
    k.pack.notes = body(300);
    expect(checkOriginality(k).passed).toBe(false);
  });

  it('checks the language of the text', () => {
    const i = good();
    i.lang = 'ar';
    expect(checkLanguage(i).passed).toBe(false);
  });

  it('weights risk by what failed, and lets advisory results pass the gates', () => {
    expect(riskScore([{ name: 'claims-verified', passed: false, severity: 'blocker' }, { name: 'voice', passed: false, severity: 'advisory' }])).toBe(45);
    expect(gatesPassed([{ passed: false, severity: 'advisory' }, { passed: true, severity: 'blocker' }])).toBe(true);
    expect(gatesPassed([{ passed: false, severity: 'blocker' }])).toBe(false);
  });

  it('measures title similarity by shared words', () => {
    expect(titleSimilarity('How to pick a plan for travel', 'Pick a travel plan: how to')).toBeGreaterThan(0.8);
    expect(titleSimilarity('Cats and dogs', 'Quarterly taxes')).toBe(0);
  });
});
