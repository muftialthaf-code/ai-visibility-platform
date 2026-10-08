import { inviteIsOpen, getSetting } from '@avp/db';
import { DEFAULT_BRANDING, parseBranding } from '@avp/runtime';
import { TOKEN_PATTERN, hashToken } from '@/lib/onboarding';
import { getDb } from '@/lib/services';
import { OnboardingForm } from './OnboardingForm';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function OnboardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  const invite = TOKEN_PATTERN.test(token) ? await inviteIsOpen(db, hashToken(token)) : null;
  const brand = parseBranding(await getSetting(db, 'branding', DEFAULT_BRANDING));
  return (
    <main className="wrap" style={{ maxWidth: '40rem', paddingBlock: '2rem' }}>
      <h1>{brand.platformName}: tell us about your business</h1>
      {!invite ? (
        <div className="card" role="alert">This link has already been used or has expired. Ask the person who sent it for a new one.</div>
      ) : (
        <>
          <p className="muted">This takes about five minutes. It sets up your website and your AI visibility reports. You can leave anything you are unsure about blank; we will follow up.</p>
          <OnboardingForm token={token} />
        </>
      )}
    </main>
  );
}
