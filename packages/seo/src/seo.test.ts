import { describe, expect, it } from 'vitest';
import {
  AI_CRAWLERS,
  blogPosting,
  breadcrumbs,
  buildLlmsTxt,
  buildRobotsTxt,
  buildSitemapXml,
  classifyReferrer,
  direction,
  faqPage,
  hreflangAlternates,
  localizedPath,
  organization,
  toScript,
  validateJsonLd,
  website,
} from './index.ts';

const locales = { default: 'en', supported: ['en', 'ar'] };

describe('json-ld', () => {
  it('builds valid nodes', () => {
    const nodes = [
      organization({ name: 'Acme', url: 'https://acme.test' }),
      website({ name: 'Acme', url: 'https://acme.test', inLanguage: 'en' }),
      faqPage([{ question: 'Q?', answer: 'A.' }]),
      breadcrumbs([{ name: 'Home', url: 'https://acme.test/' }]),
      blogPosting({
        headline: 'H',
        description: 'D',
        url: 'https://acme.test/blog/h/',
        datePublished: '2026-01-01',
        dateModified: '2026-01-02',
        inLanguage: 'en',
        authorName: 'A',
        publisherName: 'Acme',
      }),
    ];
    for (const n of nodes) expect(validateJsonLd(n)).toEqual([]);
  });

  it('flags missing required fields', () => {
    expect(validateJsonLd({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [] })).toContain('FAQPage: missing "mainEntity"');
  });

  it('escapes script-closing sequences', () => {
    expect(toScript(organization({ name: '</script><b>', url: 'https://x.test' }))).not.toContain('</script>');
  });
});

describe('robots.txt', () => {
  it('allows every AI crawler by default and lists the sitemap', () => {
    const txt = buildRobotsTxt({ siteUrl: 'https://acme.test/' });
    for (const bot of AI_CRAWLERS) expect(txt).toContain(`User-agent: ${bot}\nAllow: /`);
    expect(txt).toContain('Sitemap: https://acme.test/sitemap.xml');
  });

  it('applies per-tenant overrides', () => {
    const txt = buildRobotsTxt({ siteUrl: 'https://acme.test', overrides: { GPTBot: false } });
    expect(txt).toContain('User-agent: GPTBot\nDisallow: /');
    expect(txt).toContain('User-agent: ClaudeBot\nAllow: /');
  });

  it('blocks everything for staging', () => {
    expect(buildRobotsTxt({ siteUrl: 'https://acme.test', blockAll: true })).toBe('User-agent: *\nDisallow: /\n');
  });
});

describe('hreflang and paths', () => {
  it('keeps the default language at the root and prefixes the rest', () => {
    expect(localizedPath('/faq', 'en', locales)).toBe('/faq/');
    expect(localizedPath('/faq', 'ar', locales)).toBe('/ar/faq/');
    expect(localizedPath('/', 'ar', locales)).toBe('/ar/');
    expect(localizedPath('/', 'en', locales)).toBe('/');
  });

  it('includes x-default', () => {
    const alts = hreflangAlternates('https://acme.test', '/faq', locales);
    expect(alts.map((a) => a.hreflang)).toEqual(['en', 'ar', 'x-default']);
    expect(alts[2]?.href).toBe('https://acme.test/faq/');
  });

  it('marks Arabic as RTL', () => {
    expect(direction('ar')).toBe('rtl');
    expect(direction('en')).toBe('ltr');
  });
});

describe('sitemap', () => {
  it('emits one url per language with alternates', () => {
    const xml = buildSitemapXml('https://acme.test', [{ path: '/faq' }], locales);
    expect(xml).toContain('<loc>https://acme.test/faq/</loc>');
    expect(xml).toContain('<loc>https://acme.test/ar/faq/</loc>');
    expect(xml).toContain('hreflang="x-default"');
  });

  it('only lists the languages a page exists in', () => {
    const xml = buildSitemapXml('https://acme.test', [{ path: '/blog/a', languages: ['en'] }], locales);
    expect(xml).toContain('<loc>https://acme.test/blog/a/</loc>');
    expect(xml).not.toContain('/ar/blog/a/');
  });
});

describe('llms.txt', () => {
  it('follows the llmstxt.org shape', () => {
    const txt = buildLlmsTxt({
      name: 'Acme',
      summary: 'Does things.',
      sections: [{ title: 'Pages', links: [{ title: 'FAQ', url: 'https://acme.test/faq/', note: 'Answers' }] }],
    });
    expect(txt.startsWith('# Acme\n\n> Does things.\n')).toBe(true);
    expect(txt).toContain('- [FAQ](https://acme.test/faq/): Answers');
  });
});

describe('ai referrers', () => {
  it('classifies assistant referrers', () => {
    expect(classifyReferrer('https://chatgpt.com/')).toBe('ChatGPT');
    expect(classifyReferrer('https://www.google.com/')).toBeNull();
    expect(classifyReferrer('')).toBeNull();
  });
});
