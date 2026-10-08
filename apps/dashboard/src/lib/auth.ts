import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getUser, logAudit, type User } from '@avp/db';
import { config } from './env.ts';
import { signSession, verifySession } from './crypto.ts';
import { can, type Capability } from './permissions.ts';
import { getDb } from './services.ts';

const COOKIE = 'avp_session';

export interface SessionUser extends User {
  mfa: boolean;
}

export async function startSession(userId: string, mfa: boolean): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + config.sessionHours() * 3600;
  const jar = await cookies();
  jar.set(COOKIE, signSession({ uid: userId, mfa, exp }, config.sessionSecret()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: config.sessionHours() * 3600,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** The signed-in user, re-read from the database so disabling an account takes effect immediately. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  const payload = verifySession(token, config.sessionSecret());
  if (!payload) return null;
  const user = await getUser(await getDb(), payload.uid);
  if (!user || user.disabled) return null;
  return { ...user, mfa: payload.mfa };
}

/**
 * Gate for pages and actions. Redirects to login when signed out, and to 2FA enrolment when the
 * account still needs it. Pass a capability to also enforce the role table.
 */
export async function requireUser(capability?: Capability, tenantId?: string): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (config.require2fa() && !user.mfa) redirect(user.totp_enabled ? '/login' : '/setup-2fa');
  if (capability && !can(user, capability, tenantId)) redirect('/forbidden');
  return user;
}

export async function audit(user: { id?: string; email: string }, action: string, target?: string, detail?: Record<string, unknown>) {
  await logAudit(await getDb(), { userId: user.id ?? null, userEmail: user.email, action, target, detail });
}
