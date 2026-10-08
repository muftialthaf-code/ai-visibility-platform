import { absoluteUrl, hreflangAlternates, localizedPath, type LocaleInfo } from './hreflang.ts';

export interface SitemapPage {
  /** Path without a language prefix, e.g. "/faq/". */
  path: string;
  lastmod?: string;
  /** Languages this page exists in. Defaults to every supported language. */
  languages?: string[];
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildSitemapXml(siteUrl: string, pages: SitemapPage[], locales: LocaleInfo): string {
  const urls: string[] = [];
  for (const page of pages) {
    const langs = page.languages ?? locales.supported;
    const pageLocales: LocaleInfo = { default: locales.default, supported: langs };
    const alternates = hreflangAlternates(siteUrl, page.path, { ...pageLocales, default: langs.includes(locales.default) ? locales.default : langs[0]! });
    for (const lang of langs) {
      const loc = absoluteUrl(siteUrl, localizedPath(page.path, lang, locales));
      const links = alternates
        .map((a) => `    <xhtml:link rel="alternate" hreflang="${esc(a.hreflang)}" href="${esc(a.href)}"/>`)
        .join('\n');
      urls.push(
        [`  <url>`, `    <loc>${esc(loc)}</loc>`, page.lastmod ? `    <lastmod>${esc(page.lastmod)}</lastmod>` : '', links, `  </url>`]
          .filter(Boolean)
          .join('\n'),
      );
    }
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}
