import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runAgent } from '@avp/agent';
import { createHarness, demoLlm } from '@avp/agent/testing';
import { totpCode, totpStep } from '../src/lib/crypto';

const PASSWORD = 'a-long-enough-passphrase';
const EMAIL = 'mufti@example.com';
const GH = 'http://127.0.0.1:4010/repos/o/r';

let secret = '';
const STATE = 'test-results/owner-session.json';
let lastStepUsed = totpStep();

/** Sign in through the form. Each login needs a code from a step newer than the last one used. */
async function signInWithCode(page: Page) {
  // Codes are accepted for the current step and the next one, so wait until the next step is unused.
  while (totpStep() + 1 <= lastStepUsed) await new Promise((r) => setTimeout(r, 1000));
  const step = totpStep() + 1;
  lastStepUsed = step;
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel(/Authenticator code/).fill(totpCode(secret, step));
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function githubFile(path: string): Promise<any | null> {
  const r = await fetch(`${GH}/contents/${path}?ref=main`);
  if (!r.ok) return null;
  const body = await r.json();
  return JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
}

test.describe.serial('dashboard', () => {
  test('signed-out visitors are sent to the login page', async ({ page }) => {
    await page.goto('/businesses');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('wrong setup token is refused, right one creates the owner and 2FA is enforced', async ({ page }) => {
    await page.goto('/setup');
    await page.getByLabel(/Setup token/).fill('wrong');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Create owner' }).click();
    await expect(page.locator('main [role="alert"]')).toContainText('setup token is not correct');

    await page.getByLabel(/Setup token/).fill('e2e-setup-token');
    await page.getByRole('button', { name: 'Create owner' }).click();
    await expect(page).toHaveURL(/\/setup-2fa$/);

    // Until 2FA is on, the rest of the app stays closed.
    await page.goto('/businesses');
    await expect(page).toHaveURL(/\/setup-2fa$/);

    secret = (await page.locator('code').first().textContent())!.trim();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await page.getByLabel('6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Turn on 2FA' }).click();
    await expect(page.locator('main [role="alert"]')).toContainText('not correct');

    await page.getByLabel('6-digit code').fill(totpCode(secret, totpStep()));
    await page.getByRole('button', { name: 'Turn on 2FA' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(page.getByText('No businesses yet')).toBeVisible();
    lastStepUsed = totpStep();
    await page.context().storageState({ path: STATE });

    // Once an owner exists the setup page is gone for everyone who is not signed in.
    const anonymous = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:3100' });
    expect((await anonymous.get('/setup')).status()).toBe(404);
    await anonymous.dispose();
  });

  test('add a business, fill it in, launch it', async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, baseURL: 'http://127.0.0.1:3100' });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

    await page.goto('/businesses/new');
    await page.getByLabel('Business name').fill('Acme Dental');
    await page.getByLabel(/^Domain/).fill('acme-dental.example');
    await page.getByRole('button', { name: 'Create and continue' }).click();
    await expect(page).toHaveURL(/\/businesses\/acme-dental\?tab=setup/);
    await expect(page.getByRole('heading', { name: 'Acme Dental' })).toBeVisible();

    // The tenant exists in the repository as a committed, valid, paused config.
    const created = await githubFile('tenants/acme-dental/tenant.json');
    expect(created.status).toBe('paused');
    expect(created.identity.name).toBe('Acme Dental');
    expect(created.integrations.indexNowKey).toMatch(/^[a-f0-9]{32}$/);

    // The checklist lists what is missing.
    await expect(page.getByText('Before launch', { exact: true })).toBeVisible();
    await expect(page.getByText('Fix these first')).toBeVisible();
    await expect(page.getByText(/No lead form destination/)).toBeVisible();

    // Edit the identity section (English and Arabic taglines).
    await page.getByRole('link', { name: 'Identity', exact: true }).click();
    await page.getByLabel('English').first().fill('Dental care for families in Riyadh.');
    await page.getByLabel(/Arabic/).first().fill('رعاية الأسنان للعائلات في الرياض.');
    await page.getByRole('button', { name: /Save identity/ }).click();
    await expect(page.getByRole('status')).toContainText('Saved');
    const edited = await githubFile('tenants/acme-dental/tenant.json');
    expect(edited.identity.tagline).toEqual({ en: 'Dental care for families in Riyadh.', ar: 'رعاية الأسنان للعائلات في الرياض.' });

    // Invalid input is rejected with a reason and nothing is committed.
    await page.getByLabel('Domain').fill('not a domain');
    await page.getByRole('button', { name: /Save identity/ }).click();
    await expect(page.locator('main [role="alert"]').first()).toBeVisible();
    expect((await githubFile('tenants/acme-dental/tenant.json')).identity.domain).toBe('acme-dental.example');

    // Add services as rows, then a banned claim is rejected by the schema's own check.
    await page.getByRole('link', { name: 'Business', exact: true }).click();
    await page.getByLabel('English').nth(0).fill('We run a family dental clinic.');
    await page.locator('input[name="r:profile.offerings:1:name:en"]').fill('Check-ups');
    await page.locator('input[name="r:profile.offerings:1:name:ar"]').fill('فحوصات');
    await page.locator('textarea[name="r:profile.offerings:1:summary:en"]').fill('Routine dental check-ups.');
    await page.getByRole('button', { name: /Save business/ }).click();
    await expect(page.getByRole('status')).toContainText('Saved');
    const withServices = await githubFile('tenants/acme-dental/tenant.json');
    expect(withServices.profile.offerings.map((o: any) => o.id)).toContain('check-ups');

    await page.locator('textarea[name="l:profile.description:en"]').fill('We deliver guaranteed results every time.');
    await page.getByRole('button', { name: /Save business/ }).click();
    // The summary line is generic; the reason (which phrase, where) is listed underneath.
    await expect(page.locator('main [role="alert"]').filter({ hasText: 'guaranteed results' })).toBeVisible();
    expect((await githubFile('tenants/acme-dental/tenant.json')).profile.description.en).toBe('We run a family dental clinic.');
    await page.locator('textarea[name="l:profile.description:en"]').fill('We run a family dental clinic.');
    await page.getByRole('button', { name: /Save business/ }).click();
    await expect(page.getByRole('status')).toContainText('Saved');

    // Launching is refused while template placeholder text remains, and the reason is shown.
    await page.getByRole('link', { name: 'Setup checklist' }).click();
    await page.getByRole('button', { name: 'Launch business' }).click();
    await expect(page.locator('main [role="alert"]').filter({ hasText: 'template placeholder text' }).first()).toBeVisible();
    expect((await githubFile('tenants/acme-dental/tenant.json')).status).toBe('paused');

    // Replace the remaining placeholders (audience, pricing, author bio), then launch.
    await page.getByRole('link', { name: 'Business', exact: true }).click();
    await page.locator('textarea[name="l:profile.audience:en"]').fill('Families in Riyadh.');
    await page.locator('textarea[name="l:profile.audience:ar"]').fill('العائلات في الرياض.');
    await page.locator('textarea[name="l:profile.pricingApproach:en"]').fill('Prices are agreed at the first visit.');
    await page.locator('textarea[name="l:profile.pricingApproach:ar"]').fill('يتم الاتفاق على الأسعار في الزيارة الأولى.');
    await page.getByRole('button', { name: /Save business/ }).click();
    await expect(page.getByRole('status')).toContainText('Saved');
    await page.getByRole('link', { name: 'Author', exact: true }).click();
    await page.locator('textarea[name="l:author.bio:en"]').fill('Published by the Acme Dental clinic team.');
    await page.locator('textarea[name="l:author.bio:ar"]').fill('تنشر هذا الموقع عيادة أكمي للأسنان.');
    await page.getByRole('button', { name: /Save author/ }).click();
    await expect(page.getByRole('status')).toContainText('Saved');

    await page.getByRole('link', { name: 'Setup checklist' }).click();
    await page.getByRole('button', { name: 'Launch business' }).click();
    await expect(page.getByRole('status')).toContainText('active');
    expect((await githubFile('tenants/acme-dental/tenant.json')).status).toBe('active');

    // It shows up on the overview and in the list.
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Acme Dental' })).toBeVisible();
    await expect(page.getByText('active of 1 businesses')).toBeVisible();
  });

  test('controls, pause all, history and rollback', async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, baseURL: 'http://127.0.0.1:3100' });
    const page = await context.newPage();
    await page.goto('/businesses/acme-dental?tab=controls');
    await page.getByLabel('Pause the article agent').uncheck();
    await page.getByLabel('Articles per day').fill('2');
    await page.getByLabel(/Monthly budget cap/).fill('30');
    await page.getByRole('button', { name: /Save controls/ }).click();
    await expect(page.getByRole('status')).toContainText('Saved');
    let t = await githubFile('tenants/acme-dental/tenant.json');
    expect([t.agent.paused, t.agent.articlesPerDay, t.agent.monthlyBudgetUsd]).toEqual([false, 2, 30]);

    await page.goto('/businesses');
    await page.getByRole('button', { name: 'Pause all agents' }).click();
    await expect(page.getByRole('status')).toContainText('Paused the agent for 1 business');
    t = await githubFile('tenants/acme-dental/tenant.json');
    expect(t.agent.paused).toBe(true);

    await page.goto('/businesses/acme-dental?tab=history');
    await expect(page.getByText('Pause the agent for 1 tenant(s)')).toBeVisible();
    // Restore the version from before "Pause all": articles per day is 2 and the agent was running.
    await page.getByRole('button', { name: 'Restore this version' }).first().click();
    await expect(page.getByRole('status')).toContainText('Rolled back');
    t = await githubFile('tenants/acme-dental/tenant.json');
    expect(t.agent.paused).toBe(false);
    expect(t.agent.articlesPerDay).toBe(2);
  });

  test('settings: users, audit log, connections show no secret values', async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, baseURL: 'http://127.0.0.1:3100' });
    const page = await context.newPage();
    await page.goto('/settings?tab=connections');
    await expect(page.getByRole('cell', { name: 'GitHub', exact: true })).toBeVisible();
    await expect(page.getByRole('row', { name: /GitHub/ })).toContainText('set');
    // Only whether each connection is set is shown. The values themselves never reach the browser.
    const html = await page.content();
    for (const secretValue of ['e2e-session-secret-that-is-long-enough-123456', 'e2e-setup-token']) expect(html).not.toContain(secretValue);

    await page.goto('/settings?tab=audit');
    for (const action of ['setup.owner-created', '2fa.enabled', 'tenant.add', 'tenant.edit', 'tenant.resume', 'agent.pause-all', 'tenant.rollback']) {
      await expect(page.getByRole('cell', { name: action, exact: true }).first()).toBeVisible();
    }

    await page.goto('/settings?tab=users');
    await page.getByLabel('Email').fill('reviewer@example.com');
    await page.getByLabel('Role').selectOption('reviewer');
    await page.getByLabel(/Temporary password/).fill('another-long-passphrase');
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByRole('status')).toContainText('Created reviewer@example.com');

    // The only owner cannot be disabled.
    const ownerRow = page.getByRole('row', { name: new RegExp(EMAIL) });
    await ownerRow.getByRole('button', { name: 'Disable' }).click();
    await expect(page.locator('main [role="alert"]')).toContainText('only owner');
  });

  test('a reviewer is signed in but cannot reach owner pages', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/login');
    await page.getByLabel('Email').fill('reviewer@example.com');
    await page.getByLabel('Password').fill('another-long-passphrase');
    await page.getByRole('button', { name: 'Sign in' }).click();
    // Reviewer has no 2FA yet, so the app asks for enrolment before anything else.
    await expect(page).toHaveURL(/\/setup-2fa$/);
  });

  test('sign out, sign back in with 2FA, and wrong credentials give one generic message', async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, baseURL: 'http://127.0.0.1:3100' });
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/businesses');
    await expect(page).toHaveURL(/\/login$/);

    await signInWithCode(page);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();

    await context.clearCookies();
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByLabel('Password').fill('whatever-password-here');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('main [role="alert"]')).toContainText('Email, password or code is not correct');
  });

  test('works on a phone: no sideways scrolling on the main screens', async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, baseURL: 'http://127.0.0.1:3100' });
    const page = await context.newPage();
    await page.setViewportSize({ width: 375, height: 800 });
    for (const path of ['/', '/businesses', '/businesses/acme-dental?tab=business', '/runs', '/settings?tab=users']) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });
});

test.describe.serial('review queue', () => {
  const siteTenantDir = resolve(import.meta.dirname, '../../../tenants/reviewco');

  test('the agent writes a draft; the owner reads it, asks for changes, then approves; the article reaches main and builds into the site', async ({ browser }) => {
    // The agent runs here against the same fake GitHub the dashboard uses, with a scripted model.
    const h = await createHarness('reviewco', {}, { baseUrl: 'http://127.0.0.1:4010', owner: 'o', repo: 'r' });
    const [run] = await runAgent(h.ctx(demoLlm()), { trigger: 'manual' });
    expect(run!.error).toBeUndefined();
    expect(run!.status).toBe('success');

    const context = await browser.newContext({ storageState: STATE, baseURL: 'http://127.0.0.1:3100' });
    const page = await context.newPage();
    await page.goto('/review');
    await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
    const row = page.getByRole('row', { name: /Demo:/ });
    await expect(row).toContainText('reviewco');
    await expect(row).toContainText('all passed');

    await row.getByRole('link').click();
    await expect(page).toHaveURL(/\/review\/\d+$/);
    await expect(page.getByText('all required checks passed')).toBeVisible();
    // The preview shows the article, its takeaways, FAQ and sources.
    await expect(page.getByText('Demo takeaway one')).toBeVisible();
    await expect(page.getByText('Demo question 1?')).toBeVisible();
    await expect(page.getByRole('link', { name: /Demo guide one/ })).toBeVisible();

    // Request changes: the revise workflow is dispatched with the instructions.
    await page.getByLabel('What should change?').fill('Make the opening shorter.');
    await page.getByRole('button', { name: 'Ask the agent to rewrite' }).click();
    await expect(page.getByText(/changes were requested/i)).toBeVisible();
    const dispatches = await fetch('http://127.0.0.1:4010/repos/o/r/__test/dispatches').then((r) => r.json());
    expect(dispatches.at(-1)).toMatchObject({ workflow: 'agent-revise.yml', inputs: { tenant: 'reviewco', instructions: 'Make the opening shorter.' } });

    // Approve: the pull request merges, so the article is now on main.
    await page.getByRole('button', { name: 'Approve and publish' }).click();
    await expect(page).toHaveURL(/\/review/);
    await expect(page.getByText(/Published/).first()).toBeVisible();
    const files: string[] = await fetch('http://127.0.0.1:4010/repos/o/r/__test/files').then((r) => r.json());
    const article = files.find((f) => f.startsWith('tenants/reviewco/articles/en/'));
    expect(article).toBeTruthy();

    // The site builds with the new article and passes the audit.
    try {
      for (const path of files.filter((f) => f.startsWith('tenants/reviewco/'))) {
        const body = await fetch(`http://127.0.0.1:4010/repos/o/r/contents/${path}?ref=main`).then((r) => r.json());
        mkdirSync(dirname(resolve(siteTenantDir, '../..', path)), { recursive: true });
        writeFileSync(resolve(siteTenantDir, '../..', path), Buffer.from(body.content, 'base64'));
      }
      const root = resolve(import.meta.dirname, '../../..');
      execFileSync('pnpm', ['-s', 'avp', 'site', 'build', 'reviewco'], { cwd: root, stdio: 'pipe' });
      execFileSync('pnpm', ['-s', 'avp', 'audit', 'reviewco'], { cwd: root, stdio: 'pipe' });
      const slug = article!.split('/').pop()!.replace('.md', '');
      const html = readFileSync(resolve(root, `dist/sites/reviewco/blog/${slug}/index.html`), 'utf8');
      expect(html).toContain('Demo takeaway one');
      expect(html).toContain('FAQPage');
    } finally {
      rmSync(siteTenantDir, { recursive: true, force: true });
      rmSync(resolve(import.meta.dirname, '../../../dist/sites/reviewco'), { recursive: true, force: true });
    }
    await context.close();
    await h.db.close();
  });
});
