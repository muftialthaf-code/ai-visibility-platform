import { loadArticles } from '../lib/content.ts';
import { locales, siteUrl, tenant, tr, url } from '../lib/tenant.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function GET() {
  const lang = locales.default;
  const items = loadArticles(lang)
    .map(
      (a) =>
        `    <item>\n      <title>${esc(a.title)}</title>\n      <link>${url(`/blog/${a.slug}/`, lang)}</link>\n      <guid>${url(`/blog/${a.slug}/`, lang)}</guid>\n      <pubDate>${new Date(a.datePublished).toUTCString()}</pubDate>\n      <description>${esc(a.description)}</description>\n    </item>`,
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>${esc(tenant.identity.name)}</title>\n    <link>${siteUrl}/</link>\n    <description>${esc(tr(tenant.identity.tagline, lang))}</description>\n    <language>${lang}</language>\n${items}\n  </channel>\n</rss>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
