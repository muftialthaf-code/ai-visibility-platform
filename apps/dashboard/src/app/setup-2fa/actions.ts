'use server';
import { redirect } from 'next/navigation';
import { confirmTotpEnrolment } from '@/lib/login';
import { audit, currentUser, startSession } from '@/lib/auth';
import { getDb } from '@/lib/services';
import type { FormState } from '@/components/ActionForm';

export async function confirm2faAction(_prev: FormState, data: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect('/login');
  const ok = await confirmTotpEnrolment(await getDb(), user, String(data.get('code') ?? ''));
  if (!ok) return { error: 'That code is not correct. Check the time on your phone and try the next code.' };
  await startSession(user.id, true);
  await audit(user, '2fa.enabled');
  return { redirect: '/' };
}
