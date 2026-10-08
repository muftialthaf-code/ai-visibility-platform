import { describe, expect, it } from 'vitest';
import { parseCsv, normalizeItems, syncFeed, slugify } from './index.ts';
import { validateTenant } from '@avp/tenant-schema';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const template = JSON.parse(readFileSync(fileURLToPath(new URL('../../../tenants/_template/tenant.json', import.meta.url)), 'utf8'));
const tenantWith = (feeds: unknown[]) => {
  const r = validateTenant({ ...template, id: 'shop', integrations: { analytics: { provider: 'none' }, feeds } });
  if (!r.tenant) throw new Error(JSON.stringify(r.errors));
  return r.tenant;
};

describe('parseCsv', () => {
  it('handles quotes, commas, newlines in quotes, CRLF and a BOM', () => {
    const rows = parseCsv('﻿id,name,notes\r\n1,"Plan, large","say ""hi""\nthere"\r\n2,Small,\r\n\r\n');
    expect(rows).toEqual([
      { id: '1', name: 'Plan, large', notes: 'say "hi"\nthere' },
      { id: '2', name: 'Small', notes: '' },
    ]);
  });
  it('rejects an unclosed quote and returns nothing for an empty file', () => {
    expect(() => parseCsv('a,b\n"oops,1')).toThrow(/unclosed/);
    expect(parseCsv('')).toEqual([]);
  });
});

describe('normalizeItems', () => {
  const get = (r: any, f: string) => r[f];
  it('accepts good rows, generates ids, and reports bad ones instead of guessing', () => {
    const { items, problems } = normalizeItems(
      [
        { name: '5 GB', destination: 'Turkey', dataGb: '5', validityDays: '30', price: '$12.50', currency: 'usd' },
        { name: 'Bad price', destination: 'Turkey', dataGb: '5', validityDays: '30', price: 'free?', currency: 'USD' },
        { name: 'No destination', destination: '', dataGb: '1', validityDays: '7', price: '3', currency: 'USD' },
        { name: 'Unlimited', destination: 'Turkey', dataGb: 'unlimited', validityDays: '7', price: '20', currency: 'USD' },
      ],
      get,
    );
    expect(items.map((i) => [i.id, i.dataGb, i.price, i.currency])).toEqual([
      ['turkey-5-gb', 5, 12.5, 'USD'],
      ['turkey-unlimited', null, 20, 'USD'],
    ]);
    expect(problems.map((p) => p.row)).toEqual([2, 3]);
    expect(problems[0]!.message).toBe('price: price is missing or not valid');
  });
  it('flags duplicate ids', () => {
    const row = { id: 'x', name: 'A', destination: 'D', dataGb: '1', validityDays: '1', price: '1', currency: 'USD' };
    expect(normalizeItems([row, row], get).problems[0]?.message).toMatch(/duplicate/);
  });
  it('slugifies', () => expect(slugify('Saudi Arabia – 10GB')).toBe('saudi-arabia-10gb'));
});

describe('syncFeed', () => {
  const csv = 'id,name,destination,data_gb,validity_days,price,currency\na,"3 GB",France,3,30,9.99,EUR\nb,"10 GB",France,10,30,19.99,EUR\n';
  it('reads a CSV feed and sorts the catalog', async () => {
    const tenant = tenantWith([{ id: 'plans', type: 'csv' }]);
    const { catalog, problems } = await syncFeed(tenant, tenant.integrations.feeds[0]!, {
      readFile: async (p) => (p === 'tenants/shop/data/plans.csv' ? csv : null),
      now: new Date('2026-01-01T00:00:00Z'),
    });
    expect(problems).toEqual([]);
    expect(catalog.fetchedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(catalog.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('fails clearly when the CSV file is missing', async () => {
    const tenant = tenantWith([{ id: 'plans', type: 'csv' }]);
    await expect(syncFeed(tenant, tenant.integrations.feeds[0]!, { readFile: async () => null })).rejects.toThrow(/does not exist/);
  });

  const apiFeed = {
    id: 'wholesale',
    type: 'api',
    url: 'https://supplier.test/v1/plans',
    secretName: 'WHOLESALE_KEY',
    mapping: { itemsPath: 'data.plans', fields: { id: 'sku', name: 'title', destination: 'country', dataGb: 'gb', validityDays: 'days', price: 'cost', currency: 'cur' } },
  };

  it('calls an API feed with the tenant key and maps the supplier shape', async () => {
    const tenant = tenantWith([apiFeed]);
    let seen: { url: string; headers: any } | undefined;
    const fakeFetch = (async (url: string, init: any) => {
      seen = { url, headers: init.headers };
      return new Response(JSON.stringify({ data: { plans: [{ sku: 'p1', title: '1 GB', country: 'Japan', gb: 1, days: 7, cost: 4.5, cur: 'USD' }] } }), { status: 200 });
    }) as any;
    const r = await syncFeed(tenant, tenant.integrations.feeds[0]!, {
      readFile: async () => null,
      fetch: fakeFetch,
      env: { WHOLESALE_KEY: 'global-key', WHOLESALE_KEY__SHOP: 'tenant-key' },
    });
    expect(seen?.url).toBe('https://supplier.test/v1/plans');
    expect(seen?.headers.Authorization).toBe('Bearer tenant-key');
    expect(r.catalog.items[0]).toMatchObject({ id: 'p1', destination: 'Japan', price: 4.5 });
  });

  it('reports a missing secret, a supplier error and a wrong response shape', async () => {
    const tenant = tenantWith([apiFeed]);
    const feed = tenant.integrations.feeds[0]!;
    await expect(syncFeed(tenant, feed, { readFile: async () => null, env: {} })).rejects.toThrow(/WHOLESALE_KEY is not set/);
    const env = { WHOLESALE_KEY: 'k' };
    await expect(syncFeed(tenant, feed, { readFile: async () => null, env, fetch: (async () => new Response('no', { status: 503 })) as any })).rejects.toThrow(/answered 503/);
    await expect(syncFeed(tenant, feed, { readFile: async () => null, env, fetch: (async () => new Response('{"data":{"plans":"oops"}}', { status: 200 })) as any })).rejects.toThrow(/expected a list/);
  });

  it('refuses to publish an all-invalid feed rather than wiping the catalog', async () => {
    const tenant = tenantWith([{ id: 'plans', type: 'csv' }]);
    await expect(syncFeed(tenant, tenant.integrations.feeds[0]!, { readFile: async () => 'id,name\nx,y\n' })).rejects.toThrow(/none of the 1 rows were valid/);
  });
});
