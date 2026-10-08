import { describe, expect, it } from 'vitest';
import { AGENT_SCHEDULE, TRACKER_SCHEDULE, getSecret, nextRun, redact, requireSecret, tenantEnvKey, toCron } from './index.ts';

describe('secrets', () => {
  it('prefers the tenant override, then the global key', () => {
    const env = { ANTHROPIC_API_KEY: 'global-key-123', ANTHROPIC_API_KEY__ACME_DENTAL: 'tenant-key-456' };
    expect(getSecret(env, 'ANTHROPIC_API_KEY', 'acme-dental')).toBe('tenant-key-456');
    expect(getSecret(env, 'ANTHROPIC_API_KEY', 'other')).toBe('global-key-123');
    expect(getSecret(env, 'ANTHROPIC_API_KEY')).toBe('global-key-123');
    expect(tenantEnvKey('X', 'a-b.c')).toBe('X__A_B_C');
  });
  it('treats empty strings as unset and explains what is missing', () => {
    expect(getSecret({ K: '' }, 'K')).toBeUndefined();
    expect(() => requireSecret({}, 'ANTHROPIC_API_KEY', 'acme')).toThrow(/ANTHROPIC_API_KEY__ACME/);
  });
  it('redacts secret values from text', () => {
    const env = { ANTHROPIC_API_KEY: 'sk-secret-value-1', ANTHROPIC_API_KEY__T: 'sk-tenant-value-2', PATH: '/usr/bin/something' };
    const out = redact('call with sk-secret-value-1 and sk-tenant-value-2 on /usr/bin/something', env);
    expect(out).not.toContain('sk-secret-value-1');
    expect(out).not.toContain('sk-tenant-value-2');
    expect(out).toContain('/usr/bin/something');
  });
});

describe('schedule', () => {
  it('formats cron lines', () => {
    expect(toCron(AGENT_SCHEDULE)).toBe('17 5 * * *');
    expect(toCron(TRACKER_SCHEDULE)).toBe('43 6 * * 1');
  });
  it('finds the next daily run, today or tomorrow', () => {
    expect(nextRun(AGENT_SCHEDULE, new Date('2026-10-08T04:00:00Z')).toISOString()).toBe('2026-10-08T05:17:00.000Z');
    expect(nextRun(AGENT_SCHEDULE, new Date('2026-10-08T05:17:00Z')).toISOString()).toBe('2026-10-09T05:17:00.000Z');
  });
  it('finds the next weekly run', () => {
    // 2026-10-08 is a Thursday, so the next Monday is the 12th
    expect(nextRun(TRACKER_SCHEDULE, new Date('2026-10-08T12:00:00Z')).toISOString()).toBe('2026-10-12T06:43:00.000Z');
  });
});

import { DEFAULT_GLOBALS, DEFAULT_NOTIFICATIONS, parseGlobals, parseNotifications } from './index.ts';

describe('settings', () => {
  it('falls back to defaults for missing or junk input', () => {
    expect(parseGlobals(undefined)).toEqual(DEFAULT_GLOBALS);
    expect(parseGlobals('nope')).toEqual(DEFAULT_GLOBALS);
    expect(parseNotifications(null)).toEqual(DEFAULT_NOTIFICATIONS);
  });
  it('clamps numbers and rejects a bad language code', () => {
    const g = parseGlobals({ monthlyBudgetUsd: -5, maxDuplicateSimilarity: 9, minSources: '3.4', defaultLanguage: 'English', autoApproveMaxRisk: '' });
    expect(g.monthlyBudgetUsd).toBe(0);
    expect(g.maxDuplicateSimilarity).toBe(1);
    expect(g.minSources).toBe(3);
    expect(g.defaultLanguage).toBe('en');
    expect(g.autoApproveMaxRisk).toBe(DEFAULT_GLOBALS.autoApproveMaxRisk);
  });
  it('keeps a valid model id and falls back on junk', () => {
    expect(parseGlobals({ authorModel: 'claude-sonnet-5-5' }).authorModel).toBe('claude-sonnet-5-5');
    expect(parseGlobals({ authorModel: 'Not A Model!' }).authorModel).toBe(DEFAULT_GLOBALS.authorModel);
    expect(parseGlobals({}).judgeModel).toBe('claude-sonnet-5-5');
  });
  it('parses an email list from text, dropping invalid and duplicate addresses', () => {
    const n = parseNotifications({ emails: 'a@x.com, b@y.org; not-an-email\nA@x.com a@x.com', reminderAfterHours: 99999 });
    expect(n.emails).toEqual(['a@x.com', 'b@y.org']);
    expect(n.reminderAfterHours).toBe(720);
  });
});

describe('parseBranding', () => {
  it('falls back to the defaults, trims, caps length and strips markup characters', async () => {
    const { parseBranding, DEFAULT_BRANDING } = await import('./settings.ts');
    expect(parseBranding(null)).toEqual(DEFAULT_BRANDING);
    expect(parseBranding({ platformName: '  <b>Acme</b> Reports ', reportFooter: 'x'.repeat(500) })).toEqual({ platformName: 'bAcme/b Reports', reportFooter: 'x'.repeat(200) });
    expect(parseBranding({ platformName: '   ' }).platformName).toBe('Control dashboard');
  });
});
