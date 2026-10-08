// Starts a fake GitHub (seeded with the blank template) and the production dashboard build wired to it.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FakeGitHub, serveFake } from '@avp/github/fake';

const root = resolve(import.meta.dirname, '../../..');
const fake = new FakeGitHub('o', 'r', { 'tenants/_template/tenant.json': readFileSync(resolve(root, 'tenants/_template/tenant.json'), 'utf8') });
await serveFake(fake, 4010);

const next = spawn('pnpm', ['exec', 'next', 'start', '-p', '3100', '-H', '127.0.0.1'], {
  cwd: resolve(import.meta.dirname, '..'),
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: 'pglite://memory',
    SESSION_SECRET: 'e2e-session-secret-that-is-long-enough-123456',
    SETUP_TOKEN: 'e2e-setup-token',
    GITHUB_TOKEN: 'fake',
    GITHUB_OWNER: 'o',
    GITHUB_REPO: 'r',
    GITHUB_API_URL: 'http://127.0.0.1:4010',
  },
});
next.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGTERM', () => next.kill('SIGTERM'));
process.on('SIGINT', () => next.kill('SIGINT'));
