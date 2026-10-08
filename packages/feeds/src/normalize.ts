import { catalogItemSchema, type Catalog, type CatalogItem } from '@avp/tenant-schema';

export interface Problem {
  row: number;
  message: string;
}

export interface NormalizeResult {
  items: CatalogItem[];
  problems: Problem[];
}

export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const cleaned = v.replace(/[^0-9.\-]/g, '');
  const n = cleaned === '' ? NaN : Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
};

/** Read a dot path ("data.plans[0].price" is not supported; use "a.b.c") out of an object. */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split('.').reduce<any>((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

/**
 * Turn supplier records into catalog items. `get(record, field)` returns the raw value for a catalog field
 * ("id", "name", "destination", "dataGb", "validityDays", "price", "currency", "url").
 * Bad rows are reported and skipped, never guessed at.
 */
export function normalizeItems(records: unknown[], get: (record: any, field: string) => unknown): NormalizeResult {
  const items: CatalogItem[] = [];
  const problems: Problem[] = [];
  const seen = new Set<string>();

  records.forEach((record, i) => {
    const row = i + 1;
    const name = String(get(record, 'name') ?? '').trim();
    const destination = String(get(record, 'destination') ?? '').trim();
    const rawData = get(record, 'dataGb');
    const unlimited = typeof rawData === 'string' && /^(unlimited|∞|null)?$/i.test(rawData.trim()) && rawData.trim() !== '' ? true : rawData === null;
    const rawId = String(get(record, 'id') ?? '').trim();

    const candidate = {
      id: slugify(rawId || `${destination}-${name}`),
      name,
      destination,
      dataGb: unlimited ? null : num(rawData),
      validityDays: num(get(record, 'validityDays')),
      price: num(get(record, 'price')),
      currency: String(get(record, 'currency') ?? '').trim().toUpperCase(),
      url: String(get(record, 'url') ?? '').trim() || undefined,
    };
    const parsed = catalogItemSchema.safeParse(candidate);
    if (!parsed.success) {
      const first = parsed.error.issues[0]!;
      const field = first.path.join('.') || 'row';
      // Zod's own wording ("expected number, received undefined") is not helpful to someone fixing a spreadsheet.
      const friendly = /expected number|expected string|Invalid input|Too small/i.test(first.message)
        ? `${field} is missing or not valid`
        : first.message;
      problems.push({ row, message: `${field}: ${friendly}` });
    } else if (seen.has(parsed.data.id)) {
      problems.push({ row, message: `duplicate id "${parsed.data.id}"` });
    } else {
      seen.add(parsed.data.id);
      items.push(parsed.data);
    }
  });
  return { items, problems };
}

export function toCatalog(items: CatalogItem[], now = new Date()): Catalog {
  const sorted = [...items].sort((a, b) => a.destination.localeCompare(b.destination) || a.price - b.price || a.id.localeCompare(b.id));
  return { version: 1, fetchedAt: now.toISOString(), items: sorted };
}
