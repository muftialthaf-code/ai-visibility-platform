import { notFound, redirect } from 'next/navigation';
import { countUsers } from '@avp/db';
import { ActionForm } from '@/components/ActionForm';
import { currentUser } from '@/lib/auth';
import { config } from '@/lib/env';
import { getDb } from '@/lib/services';
import { setupAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const exists = (await countUsers(await getDb())) > 0;
  // Right after the owner is created this page re-renders, so a signed-in owner is sent onward instead of seeing a 404.
  if (exists) {
    const user = await currentUser();
    if (user) redirect(user.mfa || user.totp_enabled ? '/' : '/setup-2fa');
  }
  if (!config.setupToken() || exists) notFound();
  return (
    <main className="narrow wrap">
      <h1>Create the owner account</h1>
      <p className="muted">This page only works once, before any account exists.</p>
      <div className="card">
        <ActionForm action={setupAction} submit="Create owner">
          <label htmlFor="token">Setup token <span className="hint">(the SETUP_TOKEN value set on the host)</span></label>
          <input id="token" name="token" type="password" required autoComplete="off" />
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="username" />
          <label htmlFor="password">Password <span className="hint">(at least 12 characters)</span></label>
          <input id="password" name="password" type="password" required minLength={12} autoComplete="new-password" />
        </ActionForm>
      </div>
    </main>
  );
}
