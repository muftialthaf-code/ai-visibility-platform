import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateTenant } from './validate.ts';

const templatePath = fileURLToPath(new URL('../../../tenants/_template/tenant.json', import.meta.url));
const template = () => JSON.parse(readFileSync(templatePath, 'utf8'));

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
    const t = template();
    t.status = 'active';
    delete t.identity.tagline.ar;
    const r = validateTenant(t);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.message.includes('Missing "ar"'))).toBe(true);
    expect(r.warnings.some((w) => w.path === 'faq')).toBe(true);
    expect(r.warnings.some((w) => w.path === 'trackerPrompts')).toBe(true);
  });

  it('rejects non-object input without throwing', () => {
    expect(validateTenant(null).ok).toBe(false);
    expect(validateTenant('nope').ok).toBe(false);
  });
});
