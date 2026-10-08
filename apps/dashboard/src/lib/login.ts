import {
  countUsers, createUser, getUserByEmail, recentFailures, recordLoginAttempt, updateUser, type Db, type User,
} from '@avp/db';
import { DUMMY_HASH, hashPassword, newTotpSecret, passwordProblem, verifyPassword, verifyTotp } from './crypto.ts';

export const MAX_FAILURES = 5;
export const LOCKOUT_MINUTES = 15;

export type LoginResult =
  | { ok: true; user: User; mfa: boolean }
  | { ok: false; error: string; needsCode?: boolean };

/**
 * Check email, password and (when enrolled) the authenticator code.
 * Every wrong answer returns the same message, so the form never reveals which emails exist
 * or whether the password or the code was the wrong part.
 */
export async function attemptLogin(db: Db, input: { email: string; password: string; code?: string }, now = Date.now()): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const generic = 'Email, password or code is not correct.';

  if ((await recentFailures(db, email, LOCKOUT_MINUTES)) >= MAX_FAILURES) {
    return { ok: false, error: `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.` };
  }

  const user = await getUserByEmail(db, email);
  // Always run a password check, so a missing account takes as long as a real one.
  const passwordOk = await verifyPassword(input.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || user.disabled || !passwordOk) {
    await recordLoginAttempt(db, email, false);
    return { ok: false, error: generic };
  }

  if (user.totp_enabled && user.totp_secret) {
    if (!input.code?.trim()) {
      // Password was right; ask for the code without counting a failure.
      return { ok: false, error: 'Enter the 6-digit code from your authenticator app.', needsCode: true };
    }
    const step = verifyTotp(user.totp_secret, input.code, user.totp_last_step, now);
    if (step === null) {
      await recordLoginAttempt(db, email, false);
      return { ok: false, error: generic, needsCode: true };
    }
    await updateUser(db, user.id, { totp_last_step: step });
  }

  await recordLoginAttempt(db, email, true);
  return { ok: true, user, mfa: user.totp_enabled };
}

/** Start enrolment: store a fresh secret (not yet active) and return it for the QR code. */
export async function beginTotpEnrolment(db: Db, user: User): Promise<string> {
  // Reuse a pending secret so refreshing the page does not invalidate a QR code already scanned.
  if (user.totp_secret && !user.totp_enabled) return user.totp_secret;
  const secret = newTotpSecret();
  await updateUser(db, user.id, { totp_secret: secret, totp_enabled: false, totp_last_step: null });
  return secret;
}

export async function confirmTotpEnrolment(db: Db, user: User, code: string, now = Date.now()): Promise<boolean> {
  if (!user.totp_secret) return false;
  const step = verifyTotp(user.totp_secret, code, null, now);
  if (step === null) return false;
  await updateUser(db, user.id, { totp_enabled: true, totp_last_step: step });
  return true;
}

export type SetupResult = { ok: true; user: User } | { ok: false; error: string };

/** First-run owner creation from the browser. Only works while no users exist and the setup token matches. */
export async function setupOwner(
  db: Db,
  input: { token: string; email: string; password: string },
  expectedToken: string | undefined,
): Promise<SetupResult> {
  if (!expectedToken) return { ok: false, error: 'First-run setup is not enabled. Set SETUP_TOKEN on the dashboard host.' };
  if ((await countUsers(db)) > 0) return { ok: false, error: 'Setup has already been completed.' };
  if (input.token !== expectedToken) return { ok: false, error: 'The setup token is not correct.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim())) return { ok: false, error: 'Enter a valid email address.' };
  const problem = passwordProblem(input.password);
  if (problem) return { ok: false, error: problem };
  const user = await createUser(db, { email: input.email, passwordHash: await hashPassword(input.password), role: 'owner' });
  return { ok: true, user };
}
