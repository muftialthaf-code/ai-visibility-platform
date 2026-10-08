'use server';
import { createUser, getUser, listUsers, setSetting, updateUser, type Role } from '@avp/db';
import { parseGlobals, parseNotifications } from '@avp/runtime';
import type { FormState } from '@/components/ActionForm';
import { audit, requireUser } from '@/lib/auth';
import { hashPassword, passwordProblem } from '@/lib/crypto';
import { getDb } from '@/lib/services';

const ROLES: Role[] = ['owner', 'editor', 'reviewer', 'client'];
const text = (d: FormData, k: string) => String(d.get(k) ?? '').trim();

export async function createUserAction(_prev: FormState, data: FormData): Promise<FormState> {
  const me = await requireUser('users:manage');
  const email = text(data, 'email').toLowerCase();
  const role = text(data, 'role') as Role;
  const tenantId = text(data, 'tenantId') || null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email address.' };
  if (!ROLES.includes(role)) return { error: 'Choose a role.' };
  if (role === 'client' && !tenantId) return { error: 'A client account needs the business id it belongs to.' };
  const problem = passwordProblem(String(data.get('password') ?? ''));
  if (problem) return { error: problem };
  try {
    await createUser(await getDb(), { email, passwordHash: await hashPassword(String(data.get('password'))), role, tenantId: role === 'client' ? tenantId : null });
  } catch {
    return { error: 'A user with that email already exists.' };
  }
  await audit(me, 'user.create', email, { role, tenantId });
  return { ok: `Created ${email}. Share the temporary password privately. They will be asked to set up 2FA at first sign-in.`, reload: true };
}

/** Never let the last active owner be demoted or disabled. */
async function wouldRemoveLastOwner(targetId: string): Promise<boolean> {
  const owners = (await listUsers(await getDb())).filter((u) => u.role === 'owner' && !u.disabled);
  return owners.length === 1 && owners[0]!.id === targetId;
}

export async function updateUserAction(_prev: FormState, data: FormData): Promise<FormState> {
  const me = await requireUser('users:manage');
  const db = await getDb();
  const id = text(data, 'id');
  const target = await getUser(db, id);
  if (!target) return { error: 'User not found.' };
  const op = text(data, 'op');

  if (op === 'disable' || op === 'enable') {
    if (op === 'disable' && (await wouldRemoveLastOwner(id))) return { error: 'You cannot disable the only owner.' };
    await updateUser(db, id, { disabled: op === 'disable' });
  } else if (op === 'reset-2fa') {
    await updateUser(db, id, { totp_enabled: false, totp_secret: null, totp_last_step: null });
  } else if (op === 'role') {
    const role = text(data, 'role') as Role;
    if (!ROLES.includes(role)) return { error: 'Choose a role.' };
    if (target.role === 'owner' && role !== 'owner' && (await wouldRemoveLastOwner(id))) return { error: 'You cannot demote the only owner.' };
    const tenantId = role === 'client' ? text(data, 'tenantId') || target.tenant_id : null;
    if (role === 'client' && !tenantId) return { error: 'A client account needs a business id.' };
    await updateUser(db, id, { role, tenant_id: tenantId });
  } else if (op === 'password') {
    const password = String(data.get('password') ?? '');
    const problem = passwordProblem(password);
    if (problem) return { error: problem };
    await updateUser(db, id, { password_hash: await hashPassword(password) });
  } else {
    return { error: 'Unknown action.' };
  }
  await audit(me, `user.${op}`, target.email);
  return { ok: 'Done.', reload: true };
}

export async function saveDefaultsAction(_prev: FormState, data: FormData): Promise<FormState> {
  const me = await requireUser('settings:manage');
  const values = parseGlobals(Object.fromEntries(data.entries()));
  await setSetting(await getDb(), 'defaults', values);
  await audit(me, 'settings.defaults', undefined, values as unknown as Record<string, unknown>);
  return { ok: 'Saved. New businesses and the next agent run use these values.', reload: true };
}

export async function saveNotificationsAction(_prev: FormState, data: FormData): Promise<FormState> {
  const me = await requireUser('settings:manage');
  const values = parseNotifications({
    emails: text(data, 'emails'),
    notifyOnNewDraft: data.get('notifyOnNewDraft') === 'on',
    notifyOnFailure: data.get('notifyOnFailure') === 'on',
    reminderAfterHours: data.get('reminderAfterHours'),
    budgetAlertPercent: data.get('budgetAlertPercent'),
  });
  await setSetting(await getDb(), 'notifications', values);
  await audit(me, 'settings.notifications', undefined, { recipients: values.emails.length });
  return { ok: 'Saved.', reload: true };
}
