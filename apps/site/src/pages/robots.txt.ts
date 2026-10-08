import { buildRobotsTxt } from '@avp/seo';
import { isStaging, siteUrl, tenant } from '../lib/tenant.ts';

export function GET() {
  const body = buildRobotsTxt({
    siteUrl,
    allowAI: tenant.crawlers.allowAI,
    overrides: tenant.crawlers.overrides,
    blockAll: isStaging,
  });
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
