import type { SitemapPage } from '@avp/seo';
import { hasLegal, locales, pageEnabled, tenant } from './tenant.ts';
import { allArticles } from './content.ts';

/** Every indexable page (language-less paths), shared by sitemap.xml and llms.txt. */
export function sitePages(): Array<SitemapPage & { titleKey: string; title?: string }> {
  const pages: Array<SitemapPage & { titleKey: string; title?: string }> = [];
  const add = (path: string, titleKey: string, extra: Partial<SitemapPage> & { title?: string } = {}) => pages.push({ path, titleKey, ...extra });

  if (pageEnabled('home')) add('/', 'home');
  if (pageEnabled('services') && tenant.profile.offerings.length > 0) {
    add('/services/', 'services');
    for (const o of tenant.profile.offerings) add(`/services/${o.id}/`, 'service', { title: o.id });
  }
  if (pageEnabled('pricing')) add('/pricing/', 'pricing');
  if (pageEnabled('about')) add('/about/', 'about');
  if (pageEnabled('faq') && tenant.faq.length > 0) add('/faq/', 'faq');
  if (pageEnabled('contact')) add('/contact/', 'contact');
  if (pageEnabled('blog')) {
    add('/blog/', 'blog');
    const bySlug = new Map<string, { langs: string[]; lastmod: string }>();
    for (const a of allArticles()) {
      const e = bySlug.get(a.slug) ?? { langs: [], lastmod: a.dateModified };
      e.langs.push(a.lang);
      if (a.dateModified > e.lastmod) e.lastmod = a.dateModified;
      bySlug.set(a.slug, e);
    }
    for (const [slug, e] of bySlug) add(`/blog/${slug}/`, 'article', { languages: e.langs, lastmod: e.lastmod });
  }
  for (const doc of ['privacy', 'terms'] as const) if (hasLegal(doc)) add(`/legal/${doc}/`, doc);

  return pages.map((p) => ({ ...p, languages: p.languages ?? locales.supported }));
}
