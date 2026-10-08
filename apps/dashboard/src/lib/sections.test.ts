import { describe, expect, it } from 'vitest';
import { SECTIONS, buildPatch, fname, getByPath, lname, rname, slugify, type Section } from './sections.ts';

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const section = (key: string) => SECTIONS.find((s) => s.key === key)!;
const langs = ['en', 'ar'];

describe('buildPatch', () => {
  it('parses scalars, numbers, selects and unchecked checkboxes', () => {
    const patch = buildPatch(
      section('controls'),
      form({
        [fname('status')]: 'active',
        [fname('agent.publishMode')]: 'auto',
        [fname('agent.articlesPerDay')]: '3',
        [fname('agent.monthlyBudgetUsd')]: '25.5',
        [fname('agent.articleWords.min')]: '',
        // agent.paused checkbox left unchecked
      }),
      langs,
    );
    expect(patch).toEqual({ status: 'active', agent: { paused: false, publishMode: 'auto', articlesPerDay: 3, monthlyBudgetUsd: 25.5, autoApproveMaxRisk: null, articleLanguages: [] } });
  });

  it('a blank nullable number clears the value, a blank plain number leaves it alone', () => {
    const patch = buildPatch(section('controls'), form({ [fname('agent.autoApproveMaxRisk')]: '', [fname('agent.articlesPerDay')]: '' }), langs) as any;
    expect(patch.agent.autoApproveMaxRisk).toBeNull();
    expect('articlesPerDay' in patch.agent).toBe(false);
    expect((buildPatch(section('controls'), form({ [fname('agent.autoApproveMaxRisk')]: '25' }), langs) as any).agent.autoApproveMaxRisk).toBe(25);
  });

  it('a checked checkbox is true', () => {
    expect((buildPatch(section('controls'), form({ [fname('agent.paused')]: 'on' }), langs) as any).agent.paused).toBe(true);
  });

  it('collects one value per language and drops blanks', () => {
    const patch = buildPatch(section('identity'), form({ [fname('identity.name')]: 'Acme', [lname('identity.tagline', 'en')]: 'Hello', [lname('identity.tagline', 'ar')]: '   ' }), langs) as any;
    expect(patch.identity.tagline).toEqual({ en: 'Hello' });
    expect(patch.identity.name).toBe('Acme');
  });

  it('an emptied optional field becomes null so it is removed', () => {
    const patch = buildPatch(section('identity'), form({ [fname('identity.logo')]: '' }), langs) as any;
    expect(patch.identity.logo).toBeNull();
  });

  it('splits lines and trims', () => {
    const patch = buildPatch(section('strategy'), form({ [fname('pillars')]: ' one \r\n\r\n two\n' }), langs) as any;
    expect(patch.pillars).toEqual(['one', 'two']);
  });

  it('empty select with emptyIsNull removes the key', () => {
    const patch = buildPatch(section('integrations'), form({ [fname('integrations.leadForm.type')]: '' }), langs) as any;
    expect(patch.integrations.leadForm.type).toBeNull();
  });

  it('builds rows, skips blank ones and derives slugs', () => {
    const patch = buildPatch(
      section('business'),
      form({
        'n:profile.offerings': '3',
        [rname('profile.offerings', 0, 'name', 'en')]: 'Teeth Whitening',
        [rname('profile.offerings', 0, 'name', 'ar')]: 'تبييض الأسنان',
        [rname('profile.offerings', 0, 'summary', 'en')]: 'Brighter smiles.',
        [rname('profile.offerings', 1, 'name', 'en')]: '',
        [rname('profile.offerings', 2, 'name', 'en')]: 'Check-ups',
        [rname('profile.offerings', 2, 'id')]: 'my-slug',
      }),
      langs,
    ) as any;
    expect(patch.profile.offerings).toEqual([
      { name: { en: 'Teeth Whitening', ar: 'تبييض الأسنان' }, summary: { en: 'Brighter smiles.' }, id: 'teeth-whitening' },
      { name: { en: 'Check-ups' }, id: 'my-slug' },
    ]);
  });

  it('builds localized line columns for personas', () => {
    const patch = buildPatch(
      section('audience'),
      form({
        'n:personas': '1',
        [rname('personas', 0, 'name', 'en')]: 'Owner',
        [rname('personas', 0, 'painPoints', 'en')]: 'Low traffic\nHigh costs',
      }),
      ['en'],
    ) as any;
    expect(patch.personas).toEqual([{ name: { en: 'Owner' }, painPoints: { en: ['Low traffic', 'High costs'] }, id: 'owner' }]);
  });

  it('competitors rows use plain text columns', () => {
    const patch = buildPatch(section('strategy'), form({ 'n:competitors': '2', [rname('competitors', 0, 'name')]: 'Rival', [rname('competitors', 0, 'domain')]: 'rival.com', [rname('competitors', 1, 'name')]: '' }), langs) as any;
    expect(patch.competitors).toEqual([{ name: 'Rival', domain: 'rival.com' }]);
  });

  it('a section with every row removed saves an empty list', () => {
    const patch = buildPatch(section('faq'), form({ 'n:faq': '2' }), langs) as any;
    expect(patch.faq).toEqual([]);
  });
});

describe('helpers', () => {
  it('reads nested values safely', () => {
    expect(getByPath({ a: { b: 2 } }, 'a.b')).toBe(2);
    expect(getByPath({ a: null }, 'a.b.c')).toBeUndefined();
  });
  it('slugifies', () => {
    expect(slugify('  Hello, World! ')).toBe('hello-world');
    expect(slugify('تبييض')).toBe('');
  });
  it('every field path in the specs is unique within its section', () => {
    for (const s of SECTIONS as Section[]) {
      const paths = s.fields.map((f) => f.path);
      expect(new Set(paths).size).toBe(paths.length);
    }
  });
});
