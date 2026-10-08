'use server';
import { redirect } from 'next/navigation';
import { attemptLogin } from '@/lib/login';
import { audit, endSession, startSession } from '@/lib/auth';
import { config } from '@/lib/env';
import { getDb } from '@/lib/services';
import type { FormState } from '@/components/ActionForm';

export async function loginAction(_prev: FormState, data: FormData): Promise<FormState> {
  const email = String(data.get('email') ?? '');
  const result = await attemptLogin(await getDb(), {
    email,
    password: String(data.get('password') ?? ''),
    code: String(data.get('code') ?? ''),
  });
  if (!result.ok) return { error: result.error, needsCode: result.needsCode };

  await startSession(result.user.id, result.mfa);
  await audit(result.user, 'login');
  return { redirect: config.require2fa() && !result.mfa ? '/setup-2fa' : '/' };
}

export async function logoutAction() {
  await endSession();
  redirect('/login');
}
