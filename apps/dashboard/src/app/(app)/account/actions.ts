'use server';
import { getUser, updateUser } from '@avp/db';
import type { FormState } from '@/components/ActionForm';
import { audit, requireUser } from '@/lib/auth';
import { hashPassword, passwordProblem, verifyPassword } from '@/lib/crypto';
import { getDb } from '@/lib/services';

export async function changePasswordAction(_prev: FormState, data: FormData): Promise<FormState> {
  const session = await requireUser();
  const db = await getDb();
  const user = await getUser(db, session.id);
  if (!user || !(await verifyPassword(String(data.get('current') ?? ''), user.password_hash))) return { error: 'Your current password is not correct.' };
  const next = String(data.get('next') ?? '');
  if (next !== String(data.get('confirm') ?? '')) return { error: 'The new passwords do not match.' };
  const problem = passwordProblem(next);
  if (problem) return { error: problem };
  await updateUser(db, user.id, { password_hash: await hashPassword(next) });
  await audit(user, 'password.changed');
  return { ok: 'Password changed.' };
}
