import { redirect } from 'next/navigation';
import { countUsers } from '@avp/db';
import { config } from '@/lib/env';
import { currentUser } from '@/lib/auth';
import { getDb } from '@/lib/services';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const user = await currentUser();
  if (user && (user.mfa || !config.require2fa())) redirect('/');
  if (user && !user.totp_enabled) redirect('/setup-2fa');
  const noUsers = (await countUsers(await getDb())) === 0;
  return (
    <main className="narrow wrap">
      <h1>Sign in</h1>
      <p className="muted">Control dashboard</p>
      <div className="card"><LoginForm /></div>
      {noUsers && config.setupToken() && (
        <p className="small">First time here? <a href="/setup">Create the owner account</a>.</p>
      )}
    </main>
  );
}
