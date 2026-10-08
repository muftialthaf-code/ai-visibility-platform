import { buildSitemapXml } from '@avp/seo';
import { locales, siteUrl } from '../lib/tenant.ts';
import { sitePages } from '../lib/pages.ts';

export function GET() {
  const pages = sitePages().map(({ path, lastmod, languages }) => ({ path, lastmod, languages }));
  return new Response(buildSitemapXml(siteUrl, pages, locales), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
