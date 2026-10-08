'use server';
import { submitOnboarding } from '@avp/db';
import type { FormState } from '@/components/ActionForm';
import { TOKEN_PATTERN, hashToken, parseOnboarding } from '@/lib/onboarding';
import { getDb } from '@/lib/services';

export async function submitOnboardingAction(_prev: FormState, data: FormData): Promise<FormState> {
  const token = String(data.get('token') ?? '');
  // Bots that fill the hidden field get the same answer as a real visitor, and nothing is stored.
  if (String(data.get('website') ?? '') !== '') return { ok: 'Thank you. We have your details and will be in touch.' };
  if (!TOKEN_PATTERN.test(token)) return { error: 'This link is not valid.' };
  const parsed = parseOnboarding(data);
  if (!parsed.value) return { error: parsed.error };
  const id = await submitOnboarding(await getDb(), hashToken(token), parsed.value as unknown as Record<string, unknown>);
  if (!id) return { error: 'This link has already been used or has expired. Ask for a new one.' };
  return { ok: 'Thank you. We have your details and will be in touch.' };
}
