import { createHash, randomBytes } from 'node:crypto';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface OnboardingInput {
  contactName: string;
  contactEmail: string;
  businessName: string;
  domain: string;
  languages: string[];
  description: string;
  audience: string;
  services: string;
  competitors: string;
  notes: string;
}

const cap = (v: FormDataEntryValue | null, max: number) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);

/** Read and check the public form. Every field is length-capped because anyone holding the link can submit it. */
export function parseOnboarding(data: FormData): { value?: OnboardingInput; error?: string } {
  const v: OnboardingInput = {
    contactName: cap(data.get('contactName'), 120),
    contactEmail: cap(data.get('contactEmail'), 200).toLowerCase(),
    businessName: cap(data.get('businessName'), 120),
    domain: cap(data.get('domain'), 200).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
    languages: data.getAll('languages').map(String).filter((l) => /^[a-z]{2,3}$/.test(l)).slice(0, 6),
    description: cap(data.get('description'), 1500),
    audience: cap(data.get('audience'), 800),
    services: cap(data.get('services'), 1500),
    competitors: cap(data.get('competitors'), 500),
    notes: cap(data.get('notes'), 1000),
  };
  if (!v.contactName) return { error: 'Tell us your name.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.contactEmail)) return { error: 'Enter a valid email address.' };
  if (!v.businessName) return { error: 'Enter the business name.' };
  if (v.domain && !/^(?=.{4,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/.test(v.domain)) return { error: 'The website address should look like example.com.' };
  if (v.description.length < 20) return { error: 'Describe what the business does in a sentence or two.' };
  if (v.languages.length === 0) v.languages = ['en'];
  return { value: v };
}
