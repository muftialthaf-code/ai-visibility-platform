import { resolve } from 'node:path';
import { catalogSchema, loadTenant, type Catalog, type Localized, type TenantConfig } from '@avp/tenant-schema';
import { existsSync, readFileSync } from 'node:fs';
import { absoluteUrl, localizedPath, type LocaleInfo } from '@avp/seo';

const tenantId = process.env.TENANT ?? '_template';
export const tenantsDir = resolve(process.env.TENANTS_DIR ?? resolve(process.cwd(), '../../tenants'));

const result = loadTenant(tenantsDir, tenantId);
if (!result.tenant) {
  const detail = result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
  throw new Error(`Tenant "${tenantId}" is invalid:\n${detail}`);
}

export const tenant: TenantConfig = result.tenant;
export const locales: LocaleInfo = tenant.languages;
export const siteUrl = (process.env.SITE_URL ?? `https://${tenant.identity.domain}`).replace(/\/$/, '');
/** Staging builds are blocked from crawlers. */
export const isStaging = process.env.SITE_ENV === 'staging';

/** Pick the text for a language, falling back to the default language, then any language. */
export function tr(value: Localized | undefined, lang: string): string {
  if (!value) return '';
  return value[lang] ?? value[locales.default] ?? Object.values(value)[0] ?? '';
}

export function href(path: string, lang: string): string {
  return localizedPath(path, lang, locales);
}

export function url(path: string, lang: string): string {
  return absoluteUrl(siteUrl, href(path, lang));
}

export type PageKey = keyof TenantConfig['site']['pages'];
export const pageEnabled = (key: PageKey) => tenant.site.pages[key];
/** The plan catalog is published only when the module is on and the committed catalog has plans. */
export function hasCatalog(): boolean {
  return tenant.site.modules.catalog && loadCatalog() !== null && loadCatalog()!.items.length > 0;
}

export const hasLegal = (doc: 'privacy' | 'terms') => pageEnabled('legal') && Boolean(tenant.legal[doc]);

/**
 * Static paths for a page that exists once per language (plus optional extra params).
 * The default language is served at the root, so its `lang` param is undefined.
 */
export function pathsFor<T = undefined>(items: T[] = [undefined as T], params: (item: T) => Record<string, string> = () => ({})) {
  return locales.supported.flatMap((lang) =>
    items.map((item) => ({
      params: { lang: lang === locales.default ? undefined : lang, ...params(item) },
      props: { lang, item },
    })),
  );
}

export interface NavItem {
  key: string;
  path: string;
}

export function navItems(): NavItem[] {
  const items: NavItem[] = [];
  if (pageEnabled('services') && tenant.profile.offerings.length > 0) items.push({ key: 'services', path: '/services' });
  if (hasCatalog()) items.push({ key: 'plans', path: '/plans' });
  if (pageEnabled('pricing')) items.push({ key: 'pricing', path: '/pricing' });
  if (pageEnabled('about')) items.push({ key: 'about', path: '/about' });
  if (pageEnabled('faq') && tenant.faq.length > 0) items.push({ key: 'faq', path: '/faq' });
  if (pageEnabled('blog')) items.push({ key: 'blog', path: '/blog' });
  if (pageEnabled('contact')) items.push({ key: 'contact', path: '/contact' });
  return items;
}

let catalogCache: Catalog | null | undefined;

/** The committed catalog (tenants/<id>/data/catalog.json), or null when there is none. Invalid data fails the build. */
export function loadCatalog(): Catalog | null {
  if (catalogCache !== undefined) return catalogCache;
  const file = resolve(tenantsDir, tenant.id, 'data', 'catalog.json');
  if (!existsSync(file)) return (catalogCache = null);
  const parsed = catalogSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) throw new Error(`${file} is invalid: ${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}`);
  return (catalogCache = parsed.data);
}
