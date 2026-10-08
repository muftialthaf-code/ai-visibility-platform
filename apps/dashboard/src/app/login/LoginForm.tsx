'use client';
import { Messages, SubmitButton, useServerForm } from '@/components/ActionForm';
import { loginAction } from './actions';

export function LoginForm() {
  const { state, pending, ref, formAction } = useServerForm(loginAction, ['password', 'code']);
  return (
    <form ref={ref} action={formAction}>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" required autoComplete="username" />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" required autoComplete="current-password" />
      <label htmlFor="code">
        Authenticator code <span className="hint">(6 digits, if you have set up 2FA)</span>
      </label>
      <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} />
      <Messages state={state} />
      <p><SubmitButton pending={pending}>Sign in</SubmitButton></p>
    </form>
  );
}
