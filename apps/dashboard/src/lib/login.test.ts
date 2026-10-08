import { beforeEach, describe, expect, it } from 'vitest';
import { connect, createUser, getUserByEmail, migrate, type Db } from '@avp/db';
import { newTotpSecret, hashPassword, totpCode, totpStep } from './crypto.ts';
import { attemptLogin, beginTotpEnrolment, confirmTotpEnrolment, setupOwner } from './login.ts';

let db: Db;
const PASSWORD = 'a-long-enough-passphrase';
beforeEach(async () => {
  db = await connect('pglite://memory');
  await migrate(db);
});

async function owner(email = 'mufti@example.com') {
  return createUser(db, { email, passwordHash: await hashPassword(PASSWORD), role: 'owner' });
}

describe('attemptLogin', () => {
  it('accepts the right password for an account without 2FA', async () => {
    await owner();
    const r = await attemptLogin(db, { email: 'Mufti@Example.com', password: PASSWORD });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mfa).toBe(false);
  });

  it('gives the same message for a wrong password and an unknown email', async () => {
    await owner();
    const wrong = await attemptLogin(db, { email: 'mufti@example.com', password: 'nope-nope-nope-nope' });
    const unknown = await attemptLogin(db, { email: 'ghost@example.com', password: PASSWORD });
    expect(wrong).toEqual(unknown);
    expect(wrong.ok).toBe(false);
  });

  it('refuses disabled accounts', async () => {
    const u = await owner();
    await db.query('update users set disabled = true where id = $1', [u.id]);
    expect((await attemptLogin(db, { email: u.email, password: PASSWORD })).ok).toBe(false);
  });

  it('locks out after repeated failures, even for the right password', async () => {
    await owner();
    for (let i = 0; i < 5; i++) await attemptLogin(db, { email: 'mufti@example.com', password: 'wrong-wrong-wrong' });
    const r = await attemptLogin(db, { email: 'mufti@example.com', password: PASSWORD });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Too many failed attempts/);
  });
});

describe('2FA', () => {
  async function enrolled() {
    const u = await owner();
    const secret = await beginTotpEnrolment(db, u);
    const fresh = (await getUserByEmail(db, u.email))!;
    const now = 1_700_000_000_000;
    expect(await confirmTotpEnrolment(db, fresh, totpCode(secret, totpStep(now)), now)).toBe(true);
    return { secret, now };
  }

  it('enrolment needs a correct code and reuses a pending secret', async () => {
    const u = await owner();
    const s1 = await beginTotpEnrolment(db, u);
    const s2 = await beginTotpEnrolment(db, (await getUserByEmail(db, u.email))!);
    expect(s2).toBe(s1);
    expect(await confirmTotpEnrolment(db, (await getUserByEmail(db, u.email))!, '000000')).toBe(false);
    expect((await getUserByEmail(db, u.email))!.totp_enabled).toBe(false);
  });

  it('asks for the code when enrolled, without counting that as a failure', async () => {
    await enrolled();
    const r = await attemptLogin(db, { email: 'mufti@example.com', password: PASSWORD });
    expect(r).toMatchObject({ ok: false, needsCode: true });
    const rows = await db.query('select * from login_attempts where success = false');
    expect(rows.length).toBe(0);
  });

  it('rejects a wrong code, accepts a right one once, and refuses a replay', async () => {
    const { secret, now } = await enrolled();
    const later = now + 60_000; // two steps on, so the enrolment code is no longer valid
    const code = totpCode(secret, totpStep(later));
    expect((await attemptLogin(db, { email: 'mufti@example.com', password: PASSWORD, code: '123456' }, later)).ok).toBe(false);
    const ok = await attemptLogin(db, { email: 'mufti@example.com', password: PASSWORD, code }, later);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.mfa).toBe(true);
    const replay = await attemptLogin(db, { email: 'mufti@example.com', password: PASSWORD, code }, later);
    expect(replay.ok).toBe(false);
  });

  it('a right code with a wrong password still fails', async () => {
    const { secret, now } = await enrolled();
    const later = now + 60_000;
    const r = await attemptLogin(db, { email: 'mufti@example.com', password: 'wrong-wrong-wrong', code: totpCode(secret, totpStep(later)) }, later);
    expect(r.ok).toBe(false);
  });

  it('generates distinct secrets', () => {
    expect(newTotpSecret()).not.toBe(newTotpSecret());
  });
});

describe('setupOwner', () => {
  const good = { token: 'tok-123', email: 'me@example.com', password: PASSWORD };
  it('creates the first owner only with the right token', async () => {
    expect((await setupOwner(db, { ...good, token: 'wrong' }, 'tok-123')).ok).toBe(false);
    expect((await setupOwner(db, good, undefined)).ok).toBe(false);
    const r = await setupOwner(db, good, 'tok-123');
    expect(r.ok).toBe(true);
    expect((await getUserByEmail(db, 'me@example.com'))?.role).toBe('owner');
  });
  it('refuses once any user exists, and rejects weak passwords and bad emails', async () => {
    expect((await setupOwner(db, { ...good, password: 'short' }, 'tok-123')).ok).toBe(false);
    expect((await setupOwner(db, { ...good, email: 'nope' }, 'tok-123')).ok).toBe(false);
    await setupOwner(db, good, 'tok-123');
    expect((await setupOwner(db, { ...good, email: 'second@example.com' }, 'tok-123')).ok).toBe(false);
  });
});
