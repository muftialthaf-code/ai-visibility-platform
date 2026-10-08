import { describe, expect, it } from 'vitest';
import { TOKEN_PATTERN, hashToken, newToken, parseOnboarding } from './onboarding.ts';

const form = (o: Record<string, string | string[]>) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) d.append(k, x);
  return d;
};
const good = { contactName: 'Sam', contactEmail: 'Sam@Example.com', businessName: 'Acme Dental', domain: 'https://Acme-Dental.example/about', description: 'We run a family dental clinic in Riyadh.', languages: ['en', 'ar'] };

describe('onboarding input', () => {
  it('normalises the email and website, and keeps only valid languages', () => {
    const r = parseOnboarding(form({ ...good, languages: ['en', 'ar', '../x'] }));
    expect(r.value).toMatchObject({ contactEmail: 'sam@example.com', domain: 'acme-dental.example', languages: ['en', 'ar'] });
  });
  it('asks for what is missing, one thing at a time', () => {
    expect(parseOnboarding(form({ ...good, contactName: '' })).error).toContain('name');
    expect(parseOnboarding(form({ ...good, contactEmail: 'nope' })).error).toContain('email');
    expect(parseOnboarding(form({ ...good, description: 'short' })).error).toContain('Describe');
    expect(parseOnboarding(form({ ...good, domain: 'not a domain' })).error).toContain('website');
  });
  it('caps long fields instead of storing them whole', () => {
    expect(parseOnboarding(form({ ...good, description: 'x'.repeat(50_000) })).value!.description).toHaveLength(1500);
  });
  it('makes unguessable tokens and stores only a hash', () => {
    const t = newToken();
    expect(t).toMatch(TOKEN_PATTERN);
    expect(newToken()).not.toBe(t);
    expect(hashToken(t)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(t)).not.toContain(t);
  });
});
