import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { sign } from './billing.ts';

describe('webhook signature', () => {
  it('is an HMAC-SHA256 of the exact body, so a receiver can verify it', () => {
    const body = '{"month":"2026-10"}';
    expect(sign(body, 's3cret')).toBe(`sha256=${createHmac('sha256', 's3cret').update(body).digest('hex')}`);
    expect(sign(body, 's3cret')).not.toBe(sign(`${body} `, 's3cret'));
    expect(sign(body, 'other')).not.toBe(sign(body, 's3cret'));
  });
});
