import { ActionForm } from '@/components/ActionForm';
import { Badge } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { changePasswordAction } from './actions';

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <>
      <h1>Your account</h1>
      <p className="muted">{user.email} · {user.role}</p>
      <div className="card">
        <strong>Two-factor sign-in</strong>{' '}
        {user.totp_enabled ? <Badge tone="ok">on</Badge> : <Badge tone="warn">off</Badge>}
        <p className="small muted">An owner can reset 2FA for you from Settings if you lose your phone.</p>
      </div>
      <div className="card" style={{ maxWidth: '30rem' }}>
        <h2 style={{ marginTop: 0 }}>Change password</h2>
        <ActionForm action={changePasswordAction} submit="Change password">
          <label htmlFor="current">Current password</label>
          <input id="current" name="current" type="password" required autoComplete="current-password" />
          <label htmlFor="next">New password <span className="hint">(at least 12 characters)</span></label>
          <input id="next" name="next" type="password" required minLength={12} autoComplete="new-password" />
          <label htmlFor="confirm">Repeat new password</label>
          <input id="confirm" name="confirm" type="password" required minLength={12} autoComplete="new-password" />
        </ActionForm>
      </div>
    </>
  );
}
