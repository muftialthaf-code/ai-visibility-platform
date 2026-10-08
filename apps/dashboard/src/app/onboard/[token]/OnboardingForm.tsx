'use client';
import { ActionForm } from '@/components/ActionForm';
import { submitOnboardingAction } from './actions';

export function OnboardingForm({ token }: { token: string }) {
  return (
    <ActionForm action={submitOnboardingAction} submit="Send">
      <input type="hidden" name="token" value={token} />
      {/* A field real visitors never see or fill. Automated form fillers often do. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }}>
        <label htmlFor="website">Leave this empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <label htmlFor="contactName">Your name</label>
      <input id="contactName" name="contactName" type="text" required maxLength={120} autoComplete="name" />
      <label htmlFor="contactEmail">Your email</label>
      <input id="contactEmail" name="contactEmail" type="email" required maxLength={200} autoComplete="email" />
      <label htmlFor="businessName">Business name</label>
      <input id="businessName" name="businessName" type="text" required maxLength={120} />
      <label htmlFor="domain">Website address <span className="hint">(if you already have one)</span></label>
      <input id="domain" name="domain" type="text" maxLength={200} placeholder="example.com" />
      <fieldset style={{ border: 0, padding: 0, margin: '.8rem 0 0' }}>
        <legend style={{ fontWeight: 600 }}>Languages for your website</legend>
        <label style={{ fontWeight: 400 }}><input type="checkbox" name="languages" value="en" defaultChecked style={{ width: 'auto', marginRight: '.4rem' }} />English</label>
        <label style={{ fontWeight: 400 }}><input type="checkbox" name="languages" value="ar" style={{ width: 'auto', marginRight: '.4rem' }} />Arabic</label>
      </fieldset>
      <label htmlFor="description">What does the business do?</label>
      <textarea id="description" name="description" required maxLength={1500} />
      <label htmlFor="audience">Who are your customers?</label>
      <textarea id="audience" name="audience" maxLength={800} />
      <label htmlFor="services">Your main services or products <span className="hint">(one per line)</span></label>
      <textarea id="services" name="services" maxLength={1500} />
      <label htmlFor="competitors">Competitors you would like us to watch <span className="hint">(names or websites)</span></label>
      <textarea id="competitors" name="competitors" maxLength={500} style={{ minHeight: '3.5rem' }} />
      <label htmlFor="notes">Anything else we should know?</label>
      <textarea id="notes" name="notes" maxLength={1000} />
    </ActionForm>
  );
}
