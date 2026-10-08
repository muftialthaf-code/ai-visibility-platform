import type { CatalogItem } from '@avp/tenant-schema';
import { slugify } from '@avp/feeds';
import { locales, loadCatalog, tenant, tr } from './tenant.ts';
import { ui } from './i18n.ts';

export const planItems = (): CatalogItem[] => loadCatalog()?.items ?? [];

export const planName = (item: CatalogItem, lang: string): string => (typeof item.name === 'string' ? item.name : tr(item.name, lang));

/** Latin digits in every language, so prices read the same in English and Arabic pages. */
export function formatPrice(price: number, currency: string, lang: string): string {
  return new Intl.NumberFormat(`${lang}-u-nu-latn`, { style: 'currency', currency }).format(price);
}

export function formatData(item: CatalogItem, lang: string): string {
  const t = ui(lang);
  return item.dataGb === null ? t.unlimited : `${item.dataGb} ${t.gb}`;
}

export const formatValidity = (item: CatalogItem, lang: string) => `${item.validityDays} ${ui(lang).days}`;

/** A factual one-line description built only from the plan's own fields. */
export function describePlan(item: CatalogItem, lang: string): string {
  const t = ui(lang);
  return `${planName(item, lang)} ${t.covers} ${item.destination}: ${formatData(item, lang)} ${t.for} ${item.validityDays} ${t.days}, ${formatPrice(item.price, item.currency, lang)}.`;
}

export interface Destination {
  slug: string;
  name: string;
  items: CatalogItem[];
}

export function destinations(): Destination[] {
  const map = new Map<string, Destination>();
  for (const item of planItems()) {
    const slug = slugify(item.destination) || 'other';
    const d = map.get(slug) ?? { slug, name: item.destination, items: [] };
    d.items.push(item);
    map.set(slug, d);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const fetchedDate = () => (loadCatalog()?.fetchedAt ?? '').slice(0, 10);
export const catalogNote = (lang: string) => tr(tenant.site.catalogNote, lang);
export const destinationsEnabled = () => tenant.site.modules.locations;
export const supportedLangs = locales.supported;
