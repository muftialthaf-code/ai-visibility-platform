import { buildLlmsTxt, type LlmsSection } from '@avp/seo';
import { allArticles } from '../lib/content.ts';
import { ui } from '../lib/i18n.ts';
import { locales, tenant, tr, url } from '../lib/tenant.ts';
import { sitePages } from '../lib/pages.ts';

export function GET() {
  const lang = locales.default;
  const t = ui(lang);
  const pages = sitePages();
  const label = (p: (typeof pages)[number]) =>
    p.titleKey === 'service'
      ? tr(tenant.profile.offerings.find((o) => o.id === p.title)?.name, lang)
      : (t[p.titleKey as keyof typeof t] ?? p.titleKey);

  const core = pages.filter((p) => !['service', 'article', 'privacy', 'terms'].includes(p.titleKey));
  const services = pages.filter((p) => p.titleKey === 'service');
  const legal = pages.filter((p) => p.titleKey === 'privacy' || p.titleKey === 'terms');

  const sections: LlmsSection[] = [
    { title: 'Pages', links: core.map((p) => ({ title: label(p), url: url(p.path, lang) })) },
    { title: t.services, links: services.map((p) => ({ title: label(p), url: url(p.path, lang) })) },
    {
      title: t.blog,
      links: allArticles()
        .filter((a) => a.lang === lang)
        .map((a) => ({ title: a.title, url: url(`/blog/${a.slug}/`, lang), note: a.description })),
    },
    { title: 'Legal', links: legal.map((p) => ({ title: label(p), url: url(p.path, lang) })) },
  ];

  if (locales.supported.length > 1) {
    sections.push({
      title: 'Languages',
      links: locales.supported.filter((l) => l !== lang).map((l) => ({ title: l, url: url('/', l) })),
    });
  }

  const body = buildLlmsTxt({
    name: tenant.identity.name,
    summary: tr(tenant.identity.tagline, lang),
    details: tr(tenant.profile.description, lang),
    sections,
  });
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
