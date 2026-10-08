'use server';
import { setupOwner } from '@/lib/login';
import { audit, startSession } from '@/lib/auth';
import { config } from '@/lib/env';
import { getDb } from '@/lib/services';
import type { FormState } from '@/components/ActionForm';

export async function setupAction(_prev: FormState, data: FormData): Promise<FormState> {
  const r = await setupOwner(
    await getDb(),
    { token: String(data.get('token') ?? ''), email: String(data.get('email') ?? ''), password: String(data.get('password') ?? '') },
    config.setupToken(),
  );
  if (!r.ok) return { error: r.error };
  await startSession(r.user.id, false);
  await audit(r.user, 'setup.owner-created');
  return { redirect: '/setup-2fa' };
}
