import { syncFeed, type Problem } from '@avp/feeds';
import { getTenant, type TenantStore } from '@avp/tenant-ops';
import { need, type ParsedArgs } from './args.ts';

const catalogPath = (id: string) => `tenants/${id}/data/catalog.json`;

/**
 * feed sync <tenant> [--dry-run]
 * Rebuild tenants/<id>/data/catalog.json from the tenant's feeds. Sites read only that committed file,
 * so builds never need supplier credentials and a supplier outage cannot break a deploy.
 */
export async function feedCommand(sub: string | undefined, args: ParsedArgs, store: TenantStore): Promise<number> {
  if (sub !== 'sync') {
    console.log('Usage: feed sync <tenant> [--dry-run]');
    return sub ? 1 : 0;
  }
  const tenant = await getTenant(store, need(args.positional[0], 'tenant id'));
  const feeds = tenant.integrations.feeds;
  if (feeds.length === 0) throw new Error(`${tenant.id} has no integrations.feeds`);

  const problems: Array<Problem & { feed: string }> = [];
  const items = new Map<string, import('@avp/tenant-schema').CatalogItem>();
  for (const feed of feeds) {
    const r = await syncFeed(tenant, feed, { readFile: (p) => store.readFile(p), env: process.env });
    for (const p of r.problems) problems.push({ ...p, feed: feed.id });
    for (const item of r.catalog.items) {
      if (items.has(item.id)) problems.push({ feed: feed.id, row: 0, message: `id "${item.id}" already came from another feed` });
      else items.set(item.id, item);
    }
  }
  const { toCatalog } = await import('@avp/feeds');
  const catalog = toCatalog([...items.values()]);
  for (const p of problems) console.log(`  skipped ${p.feed} row ${p.row}: ${p.message}`);
  console.log(`${catalog.items.length} plan(s) from ${feeds.length} feed(s), ${problems.length} skipped.`);
  if (args.flags['dry-run']) return 0;

  const next = JSON.stringify(catalog, null, 2) + '\n';
  const current = await store.readFile(catalogPath(tenant.id));
  // Ignore the timestamp when deciding whether anything changed, so unchanged feeds do not create commits.
  const strip = (s: string | null) => (s ? s.replace(/"fetchedAt": "[^"]*"/, '') : s);
  if (strip(current) === strip(next)) {
    console.log('Catalog unchanged.');
    return 0;
  }
  await store.writeFiles([{ path: catalogPath(tenant.id), content: next }], `Update plan catalog for ${tenant.id}`);
  console.log(`Wrote ${catalogPath(tenant.id)}`);
  return 0;
}
