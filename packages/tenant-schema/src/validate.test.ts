import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateTenant } from './validate.ts';

const templatePath = fileURLToPath(new URL('../../../tenants/_template/tenant.json', import.meta.url));
const template = () => JSON.parse(readFileSync(templatePath, 'utf8'));

/** The template with every placeholder replaced by real text, so it may be launched. */
const real = () => {
  const t = template();
  t.identity.name = 'Real Co';
  t.identity.tagline = { en: 'Real tagline.', ar: 'شعار حقيقي.' };
  t.profile.description = { en: 'Real description.', ar: 'وصف حقيقي.' };
  t.profile.audience = { en: 'Real audience.', ar: 'جمهور حقيقي.' };
  t.profile.offerings = [];
  delete t.profile.pricingApproach;
  t.author.name = 'Real Co';
  t.author.bio = { en: 'Real bio.', ar: 'سيرة حقيقية.' };
  t.faq = [];
  return t;
};

describe('validateTenant', () => {
  it('accepts the blank template', () => {
    const r = validateTenant(template());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('rejects a default language that is not supported', () => {
    const t = template();
    t.languages.default = 'fr';
    const r = validateTenant(t);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === 'languages.default')).toBe(true);
  });

  it('rejects translations in unsupported languages', () => {
    const t = template();
    t.identity.tagline.fr = 'Bonjour';
    const r = validateTenant(t);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message.includes('"fr"'))).toBe(true);
  });

  it('rejects a domain with a protocol', () => {
    const t = template();
    t.identity.domain = 'https://example.com';
    expect(validateTenant(t).ok).toBe(false);
  });

  it('rejects copy that contains a banned claim', () => {
    const t = template();
    t.profile.description.en = 'We deliver guaranteed results for everyone.';
    const r = validateTenant(t);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.message).toContain('guaranteed results');
  });

  it('only gives launch-readiness warnings to active tenants', () => {
    const t = real();
    t.status = 'active';
    delete t.identity.tagline.ar;
    const r = validateTenant(t);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.message.includes('Missing "ar"'))).toBe(true);
    expect(r.warnings.some((w) => w.path === 'faq')).toBe(true);
    expect(r.warnings.some((w) => w.path === 'trackerPrompts')).toBe(true);
  });

  it('blocks launching while template placeholder text remains, but allows drafting', () => {
    const t = template();
    expect(validateTenant(t).ok).toBe(true); // paused: placeholders are fine while drafting
    t.status = 'active';
    const r = validateTenant(t);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message.includes('template placeholder text'))).toBe(true);
  });

  it('uses a lower FAQ word range for Arabic', () => {
    const t = real();
    t.status = 'active';
    t.faq = [{ question: { en: 'Q?', ar: 'س؟' }, answer: { en: Array(45).fill('word').join(' '), ar: Array(34).fill('كلمة').join(' ') } }];
    const r = validateTenant(t);
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((w) => w.path.startsWith('faq[0]'))).toEqual([]);
    t.faq[0].answer.ar = Array(20).fill('كلمة').join(' ');
    expect(validateTenant(t).warnings.some((w) => w.path === 'faq[0].answer.ar' && w.message.includes('30 to 60'))).toBe(true);
  });

  it('rejects non-object input without throwing', () => {
    expect(validateTenant(null).ok).toBe(false);
    expect(validateTenant('nope').ok).toBe(false);
  });
});
