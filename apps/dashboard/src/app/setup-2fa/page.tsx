import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { ActionForm } from '@/components/ActionForm';
import { currentUser } from '@/lib/auth';
import { otpauthUri } from '@/lib/crypto';
import { beginTotpEnrolment } from '@/lib/login';
import { getDb } from '@/lib/services';
import { confirm2faAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function Setup2faPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.totp_enabled) redirect('/');
  const secret = await beginTotpEnrolment(await getDb(), user);
  const svg = await QRCode.toString(otpauthUri(secret, user.email), { type: 'svg', margin: 1, width: 192 });
  return (
    <main className="narrow wrap">
      <h1>Set up two-factor sign-in</h1>
      <p>Scan this code with an authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit code it shows.</p>
      <div className="card">
        <div className="qr" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="small muted">Can&apos;t scan? Enter this key by hand: <code>{secret}</code></p>
        <ActionForm action={confirm2faAction} submit="Turn on 2FA">
          <label htmlFor="code">6-digit code</label>
          <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} />
        </ActionForm>
      </div>
    </main>
  );
}
