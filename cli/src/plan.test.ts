import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.ts';
import { changedUrls, planDeploys, toMatrix } from './plan.ts';
import { setToPatch } from './tenant.ts';

describe('planDeploys', () => {
  const active = ['a', 'b', 'c'];
  it('rebuilds everything when shared code changes', () => {
    expect(planDeploys(['apps/site/src/layouts/Base.astro'], active)).toEqual(['a', 'b', 'c']);
    expect(planDeploys(['packages/seo/src/jsonld.ts'], active)).toEqual(['a', 'b', 'c']);
    expect(planDeploys(['pnpm-lock.yaml'], active)).toEqual(['a', 'b', 'c']);
  });
  it('rebuilds only the tenants whose folders changed', () => {
    expect(planDeploys(['tenants/b/tenant.json', 'tenants/b/articles/en/x.md'], active)).toEqual(['b']);
  });
  it('ignores paused tenants, templates and unrelated files', () => {
    expect(planDeploys(['tenants/paused/tenant.json', 'tenants/_template/tenant.json', 'README.md', 'docs/x.md'], active)).toEqual([]);
  });
});

describe('toMatrix', () => {
  it('produces GitHub Actions matrix JSON', () => {
    expect(JSON.parse(toMatrix(['a', 'b']))).toEqual({ include: [{ tenant: 'a' }, { tenant: 'b' }] });
    expect(JSON.parse(toMatrix([]))).toEqual({ include: [] });
  });
});

describe('changedUrls', () => {
  it('maps changed articles to live URLs, default language at the root', () => {
    const urls = changedUrls(['tenants/t/articles/en/hello.md', 'tenants/t/articles/ar/marhaba.md', 'tenants/t/tenant.json'], 't', 'https://t.test', 'en');
    expect(urls).toEqual([
      'https://t.test/',
      'https://t.test/ar/blog/',
      'https://t.test/ar/blog/marhaba/',
      'https://t.test/blog/',
      'https://t.test/blog/hello/',
    ]);
  });
  it('returns nothing when no article changed', () => {
    expect(changedUrls(['tenants/t/tenant.json'], 't', 'https://t.test', 'en')).toEqual([]);
  });
});

describe('cli args', () => {
  it('collects repeated flags and supports --k=v', () => {
    const a = parseArgs(['edit', 'x', '--set', 'a=1', '--set=b=2', '--yes']);
    expect(a.positional).toEqual(['edit', 'x']);
    expect(a.all.set).toEqual(['a=1', 'b=2']);
    expect(a.flags.yes).toBe(true);
  });
  it('turns --set into a nested patch with JSON values', () => {
    expect(setToPatch('agent.articlesPerDay=3')).toEqual({ agent: { articlesPerDay: 3 } });
    expect(setToPatch('identity.name=Acme Co')).toEqual({ identity: { name: 'Acme Co' } });
    expect(() => setToPatch('nope')).toThrow(/path=value/);
  });
});
