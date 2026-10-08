'use server';
import { headers } from 'next/headers';
import { createInvite, decideOnboarding, getOnboarding, revokeInvite } from '@avp/db';
import { TenantOpError, addTenant, updateTenant } from '@avp/tenant-ops';
import type { FormState } from '@/components/ActionForm';
import { audit, requireUser } from '@/lib/auth';
import { hashToken, newToken, type OnboardingInput } from '@/lib/onboarding';
import { slugify } from '@/lib/sections';
import { getDb, getStore } from '@/lib/services';

const text = (d: FormData, k: string) => String(d.get(k) ?? '').trim();

export async function createInviteAction(_prev: FormState, data: FormData): Promise<FormState> {
  const me = await requireUser('users:manage');
  const label = text(data, 'label').slice(0, 120);
  const days = Math.min(30, Math.max(1, Number(text(data, 'days')) || 7));
  if (!label) return { error: 'Give the invite a label, for example the client name.' };
  const token = newToken();
  await createInvite(await getDb(), { tokenHash: hashToken(token), label, createdBy: me.email, expiresAt: new Date(Date.now() + days * 86400_000) });
  await audit(me, 'onboarding.invite', label, { days });
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  // The link is shown once and cannot be recovered, because only its hash is stored.
  return { ok: `Send this link to the client (shown only once, valid ${days} days, works once): ${proto}://${host}/onboard/${token}` };
}

export async function revokeInviteAction(_prev: FormState, data: FormData): Promise<FormState> {
  const me = await requireUser('users:manage');
  await revokeInvite(await getDb(), text(data, 'id'));
  await audit(me, 'onboarding.revoke', text(data, 'id'));
  return { ok: 'Revoked.', reload: true };
}

/** Turn a client's answers into a paused business that the owner then completes and launches. */
export async function acceptRequestAction(_prev: FormState, data: FormData): Promise<FormState> {
  const me = await requireUser('users:manage');
  const db = await getDb();
  const req = await getOnboarding(db, text(data, 'id'));
  if (!req || req.status !== 'pending') return { error: 'That request was already handled.' };
  const f = req.data as OnboardingInput;
  const id = slugify(text(data, 'tenantId') || f.businessName);
  const domain = text(data, 'domain').toLowerCase() || f.domain;
  if (!domain) return { error: 'This client has no website yet. Enter the domain the new site will use.' };
  const languages = f.languages?.length ? f.languages : ['en'];
  const lang = languages[0]!;
  const store = getStore(me.email);
  try {
    await addTenant(store, { id, name: f.businessName, domain, languages, defaultLanguage: lang });
    const competitors = f.competitors.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 10).map((name) => (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(name) ? { name, domain: name.toLowerCase() } : { name }));
    await updateTenant(
      store,
      id,
      {
        profile: {
          description: { [lang]: f.description },
          ...(f.audience ? { audience: { [lang]: f.audience } } : {}),
        },
        ...(competitors.length ? { competitors } : {}),
      },
      `Fill in ${id} from the client's onboarding answers`,
    );
  } catch (e) {
    return { error: e instanceof TenantOpError ? e.message.split('\n')[0] : e instanceof Error ? e.message : 'Could not create the business.' };
  }
  await decideOnboarding(db, req.id, { status: 'accepted', by: me.email, tenantId: id });
  await audit(me, 'onboarding.accept', id, { contact: f.contactEmail });
  return { ok: 'Created.', redirect: `/businesses/${id}?tab=setup` };
}

export async function rejectRequestAction(_prev: FormState, data: FormData): Promise<FormState> {
  const me = await requireUser('users:manage');
  const ok = await decideOnboarding(await getDb(), text(data, 'id'), { status: 'rejected', by: me.email, note: text(data, 'note').slice(0, 300) });
  if (!ok) return { error: 'That request was already handled.' };
  await audit(me, 'onboarding.reject', text(data, 'id'));
  return { ok: 'Rejected.', reload: true };
}
