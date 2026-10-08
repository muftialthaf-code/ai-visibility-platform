import { resolve } from 'node:path';

/** All configuration comes from environment variables, read lazily so builds never need secrets. */
const isProd = () => process.env.NODE_ENV === 'production';

export const config = {
  databaseUrl(): string {
    const url = process.env.DATABASE_URL;
    if (url) return url;
    if (isProd()) throw new Error('DATABASE_URL is not set. Add it in the dashboard host settings.');
    return 'pglite://./.data/dev';
  },
  sessionSecret(): string {
    const s = process.env.SESSION_SECRET;
    if (s && s.length >= 32) return s;
    if (isProd()) throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters.');
    return 'dev-only-session-secret-do-not-use-in-production';
  },
  /** Owners must enrol an authenticator app. Set REQUIRE_2FA=false only for local development. */
  require2fa: () => process.env.REQUIRE_2FA !== 'false',
  setupToken: () => process.env.SETUP_TOKEN || undefined,
  sessionHours: () => Number(process.env.SESSION_HOURS ?? 12),
  github: () => ({
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    branch: process.env.GITHUB_BRANCH || 'main',
    baseUrl: process.env.GITHUB_API_URL || undefined,
  }),
  /** Local development against the checked-out repo instead of GitHub. Never use in production. */
  devFs: () => process.env.AVP_DEV_FS === '1' && !isProd(),
  // The dashboard runs from apps/dashboard, so the repository root is two levels up.
  repoRoot: () => process.env.AVP_REPO_ROOT ?? resolve(process.cwd(), '../..'),
  appUrl: () => process.env.APP_URL ?? 'http://localhost:3000',
};

/** Which connections are configured. Reports presence only; values are never exposed. */
export function connectionStatus(): Array<{ name: string; ok: boolean; hint: string }> {
  const has = (k: string) => Boolean(process.env[k]);
  const gh = config.github();
  return [
    { name: 'Database', ok: has('DATABASE_URL'), hint: 'DATABASE_URL' },
    { name: 'Session secret', ok: (process.env.SESSION_SECRET ?? '').length >= 32, hint: 'SESSION_SECRET (32+ characters)' },
    { name: 'GitHub', ok: Boolean(gh.token && gh.owner && gh.repo), hint: 'GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO' },
    { name: 'Email (notifications)', ok: has('RESEND_API_KEY'), hint: 'RESEND_API_KEY, NOTIFY_FROM' },
  ];
}
