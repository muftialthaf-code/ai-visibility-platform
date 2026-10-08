import { breadcrumbs, organization, person, website, type JsonLd } from '@avp/seo';
import { href, siteUrl, tenant, tr, url } from './tenant.ts';
import { ui } from './i18n.ts';

/** Organization + WebSite, included on the home page. */
export function siteLevelJsonLd(lang: string): JsonLd[] {
  return [
    organization({
      name: tenant.identity.name,
      url: siteUrl,
      description: tr(tenant.profile.description, lang),
      logo: tenant.identity.logo ? (tenant.identity.logo.startsWith('http') ? tenant.identity.logo : `${siteUrl}${tenant.identity.logo}`) : undefined,
      areaServed: tenant.profile.geography,
    }),
    website({ name: tenant.identity.name, url: siteUrl, inLanguage: lang }),
  ];
}

export function authorJsonLd(lang: string): JsonLd {
  return person({
    name: tenant.author.name,
    description: tr(tenant.author.bio, lang),
    url: tenant.author.url,
    worksFor: tenant.author.policy === 'person' ? tenant.identity.name : undefined,
  });
}

/** Breadcrumb trail: Home > ...crumbs. Paths are language-less. */
export function crumbs(lang: string, trail: Array<{ name: string; path: string }>): JsonLd {
  return breadcrumbs([{ name: ui(lang).home, url: url('/', lang) }, ...trail.map((c) => ({ name: c.name, url: url(c.path, lang) }))]);
}

export { href };
