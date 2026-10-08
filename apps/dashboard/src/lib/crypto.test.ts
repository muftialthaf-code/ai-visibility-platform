import { describe, expect, it } from 'vitest';
import { can } from './permissions.ts';
import {
  base32Decode, base32Encode, hashPassword, newTotpSecret, otpauthUri, passwordProblem, signSession, totpCode, totpStep,
  verifyPassword, verifySession, verifyTotp,
} from './crypto.ts';

// RFC 6238 test secret: ASCII "12345678901234567890"
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('passwords', () => {
  it('hashes with a random salt and verifies', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('wrong password here', a)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
  it('enforces a minimum length', () => {
    expect(passwordProblem('short')).toMatch(/at least 12/);
    expect(passwordProblem('aaaaaaaaaaaaaa')).toMatch(/too simple/);
    expect(passwordProblem('a-long-enough-passphrase')).toBeNull();
  });
});

describe('TOTP', () => {
  it('base32 round-trips', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    const s = newTotpSecret();
    expect(base32Encode(base32Decode(s))).toBe(s);
  });
  it('matches the RFC 6238 test vectors (6-digit tail)', () => {
    expect(totpCode(RFC_SECRET, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(RFC_SECRET, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(RFC_SECRET, Math.floor(1111111111 / 30))).toBe('050471');
    expect(totpCode(RFC_SECRET, Math.floor(2000000000 / 30))).toBe('279037');
    expect(totpCode(RFC_SECRET, Math.floor(20000000000 / 30))).toBe('353130');
  });
  it('accepts the current and adjacent steps, rejects others and malformed input', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), null, now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 5), null, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', null, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', null, now)).toBeNull();
  });
  it('refuses a replayed code', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    const code = totpCode(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, step, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, step - 1, now)).toBe(step);
  });
  it('builds an otpauth URI authenticator apps accept', () => {
    const uri = otpauthUri('ABC234', 'me@example.com');
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain('secret=ABC234');
    expect(uri).toContain('me%40example.com');
  });
});

describe('session tokens', () => {
  const secret = 'test-secret-value-long-enough';
  const payload = { uid: 'u1', mfa: true, exp: 2_000_000_000 };
  it('round-trips a valid token', () => {
    expect(verifySession(signSession(payload, secret), secret, 1_900_000_000)).toEqual(payload);
  });
  it('rejects expiry, tampering, a wrong secret and junk', () => {
    const token = signSession(payload, secret);
    expect(verifySession(token, secret, 2_000_000_001)).toBeNull();
    expect(verifySession(token, 'other-secret-value-long', 1_900_000_000)).toBeNull();
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, uid: 'admin' })).toString('base64url');
    expect(verifySession(`${forged}.${sig}`, secret, 1_900_000_000)).toBeNull();
    expect(verifySession(`${body}.`, secret, 1_900_000_000)).toBeNull();
    expect(verifySession(undefined, secret)).toBeNull();
    expect(verifySession('nonsense', secret)).toBeNull();
  });
});

describe('permissions', () => {
  it('owner can do everything', () => {
    for (const c of ['users:manage', 'tenants:lifecycle', 'settings:manage'] as const) expect(can({ role: 'owner', tenant_id: null }, c)).toBe(true);
  });
  it('editors cannot manage users or remove tenants; reviewers cannot edit', () => {
    expect(can({ role: 'editor', tenant_id: null }, 'tenants:write')).toBe(true);
    expect(can({ role: 'editor', tenant_id: null }, 'users:manage')).toBe(false);
    expect(can({ role: 'editor', tenant_id: null }, 'tenants:lifecycle')).toBe(false);
    expect(can({ role: 'reviewer', tenant_id: null }, 'review:act')).toBe(true);
    expect(can({ role: 'reviewer', tenant_id: null }, 'tenants:write')).toBe(false);
  });
  it('clients only see reports for their own tenant', () => {
    const client = { role: 'client' as const, tenant_id: 'acme' };
    expect(can(client, 'reports:read', 'acme')).toBe(true);
    expect(can(client, 'reports:read', 'other')).toBe(false);
    expect(can(client, 'reports:read')).toBe(false);
    expect(can(client, 'tenants:read', 'acme')).toBe(false);
  });
});
