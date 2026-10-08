import type { TenantConfig } from '@avp/tenant-schema';
import { getSecret, type Env } from '@avp/runtime';
import { parseCsv } from './csv.ts';
import { getPath, normalizeItems, toCatalog, type Problem } from './normalize.ts';
import type { Catalog } from '@avp/tenant-schema';

type Feed = TenantConfig['integrations']['feeds'][number];

/** CSV column names for each catalog field. Suppliers' own headers can be mapped with `mapping.fields`. */
const CSV_DEFAULTS: Record<string, string> = {
  id: 'id',
  name: 'name',
  destination: 'destination',
  dataGb: 'data_gb',
  validityDays: 'validity_days',
  price: 'price',
  currency: 'currency',
  url: 'url',
};

export interface SyncResult {
  catalog: Catalog;
  problems: Problem[];
}

export interface SyncDeps {
  /** Read a file relative to the repository root (CSV feeds). */
  readFile: (path: string) => Promise<string | null>;
  fetch?: typeof fetch;
  env?: Env;
  now?: Date;
}

/**
 * Build a catalog from one feed. CSV feeds read tenants/<id>/data/<feedId>.csv. API feeds call the
 * supplier with the tenant's key from the environment. Nothing is written here: the caller commits the result.
 */
export async function syncFeed(tenant: TenantConfig, feed: Feed, deps: SyncDeps): Promise<SyncResult> {
  const fields = { ...(feed.type === 'csv' ? CSV_DEFAULTS : {}), ...(feed.mapping?.fields ?? {}) };
  const field = (record: any, name: string) => (fields[name] ? getPath(record, fields[name]!) : undefined);

  let records: unknown[];
  if (feed.type === 'csv') {
    const path = `tenants/${tenant.id}/data/${feed.id}.csv`;
    const text = await deps.readFile(path);
    if (text === null) throw new Error(`CSV feed "${feed.id}": ${path} does not exist`);
    records = parseCsv(text);
  } else {
    if (!feed.url) throw new Error(`API feed "${feed.id}" has no url`);
    if (!feed.mapping) throw new Error(`API feed "${feed.id}" has no mapping, so its response cannot be read`);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (feed.secretName) {
      const key = getSecret(deps.env ?? process.env, feed.secretName, tenant.id);
      if (!key) throw new Error(`API feed "${feed.id}": secret ${feed.secretName} is not set (tenant override ${feed.secretName}__${tenant.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')} also checked)`);
      headers[feed.authHeader ?? 'Authorization'] = (feed.authScheme ?? 'Bearer') === 'Bearer' ? `Bearer ${key}` : key;
    }
    const res = await (deps.fetch ?? fetch)(feed.url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`API feed "${feed.id}": the supplier answered ${res.status}`);
    const body = await res.json();
    const list = getPath(body, feed.mapping.itemsPath);
    if (!Array.isArray(list)) throw new Error(`API feed "${feed.id}": expected a list at "${feed.mapping.itemsPath || '(root)'}" but found ${typeof list}`);
    records = list;
  }

  const { items, problems } = normalizeItems(records, field);
  if (records.length > 0 && items.length === 0) throw new Error(`Feed "${feed.id}": none of the ${records.length} rows were valid. First problem: ${problems[0]?.message}`);
  return { catalog: toCatalog(items, deps.now), problems };
}
