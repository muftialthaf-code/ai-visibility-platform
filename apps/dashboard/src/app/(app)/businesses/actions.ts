'use server';
import {
  TenantOpError, addTenant, removeTenant, rollbackTenant, setAllAgentsPaused, updateTenant,
} from '@avp/tenant-ops';
import type { FormState } from '@/components/ActionForm';
import { audit, requireUser } from '@/lib/auth';
import { SECTIONS, buildPatch, slugify } from '@/lib/sections';
import { getStore } from '@/lib/services';

function failure(e: unknown): FormState {
  if (e instanceof TenantOpError) return { error: e.message.split('\n')[0], issues: e.issues };
  return { error: e instanceof Error ? e.message : 'Something went wrong.' };
}

const text = (d: FormData, k: string) => String(d.get(k) ?? '').trim();

export async function addBusinessAction(_prev: FormState, data: FormData): Promise<FormState> {
  const user = await requireUser('tenants:lifecycle');
  const name = text(data, 'name');
  const id = slugify(text(data, 'id') || name);
  const extra = text(data, 'extraLanguages').split(/[\s,]+/).filter(Boolean);
  const languages = [...new Set([...data.getAll('languages').map(String), ...extra])];
  if (languages.length === 0) return { error: 'Choose at least one language.' };
  const defaultLanguage = text(data, 'defaultLanguage') || languages[0]!;
  try {
    await addTenant(getStore(user.email), { id, name, domain: text(data, 'domain').toLowerCase(), languages, defaultLanguage });
  } catch (e) {
    return failure(e);
  }
  await audit(user, 'tenant.add', id, { name, languages });
  return { redirect: `/businesses/${id}?tab=setup` };
}

export async function saveSectionAction(_prev: FormState, data: FormData): Promise<FormState> {
  const id = text(data, 'tenant');
  const user = await requireUser('tenants:write', id);
  const section = SECTIONS.find((s) => s.key === text(data, 'section'));
  if (!section) return { error: 'Unknown section.' };
  const languages = data.getAll('lang').map(String);
  try {
    const patch = buildPatch(section, data, languages);
    const r = await updateTenant(getStore(user.email), id, patch, `Update ${section.title.toLowerCase()} for ${id}`);
    await audit(user, 'tenant.edit', id, { section: section.key });
    const warn = r.warnings.length ? ` (${r.warnings.length} launch note${r.warnings.length > 1 ? 's' : ''} on the Setup tab)` : '';
    return { ok: `Saved${warn}. The change is committed and will deploy automatically.` };
  } catch (e) {
    return failure(e);
  }
}

export async function saveAdvancedAction(_prev: FormState, data: FormData): Promise<FormState> {
  const id = text(data, 'tenant');
  const user = await requireUser('tenants:write', id);
  let parsed: any;
  try {
    parsed = JSON.parse(String(data.get('json') ?? ''));
  } catch (e) {
    return { error: `That is not valid JSON: ${(e as Error).message}` };
  }
  try {
    await updateTenant(getStore(user.email), id, () => parsed, `Update ${id} (advanced editor)`);
    await audit(user, 'tenant.edit', id, { section: 'advanced' });
    return { ok: 'Saved.' };
  } catch (e) {
    return failure(e);
  }
}

export async function setStatusAction(_prev: FormState, data: FormData): Promise<FormState> {
  const id = text(data, 'tenant');
  const user = await requireUser('tenants:write', id);
  const status = text(data, 'status') === 'active' ? 'active' : 'paused';
  try {
    const store = getStore(user.email);
    if (status === 'active') {
      // Launching shows the same readiness notes as the Setup tab; errors always block.
      const r = await updateTenant(store, id, { status: 'active' }, `Resume tenant ${id}`);
      await audit(user, 'tenant.resume', id, { warnings: r.warnings.length });
    } else {
      await updateTenant(store, id, { status: 'paused' }, `Pause tenant ${id}`);
      await audit(user, 'tenant.pause', id);
    }
    return { ok: status === 'active' ? 'The business is active. It deploys with the next push.' : 'The business is paused.', reload: true };
  } catch (e) {
    return failure(e);
  }
}

export async function setAgentPausedAction(_prev: FormState, data: FormData): Promise<FormState> {
  const id = text(data, 'tenant');
  const user = await requireUser('agent:control', id);
  const paused = text(data, 'paused') === 'true';
  try {
    await updateTenant(getStore(user.email), id, { agent: { paused } }, `${paused ? 'Pause' : 'Resume'} agent for ${id}`);
    await audit(user, paused ? 'agent.pause' : 'agent.resume', id);
    return { ok: paused ? 'The agent is paused.' : 'The agent is running on its schedule.', reload: true };
  } catch (e) {
    return failure(e);
  }
}

export async function pauseAllAction(_prev: FormState, data: FormData): Promise<FormState> {
  const user = await requireUser('agent:control');
  const paused = text(data, 'paused') !== 'false';
  try {
    const changed = await setAllAgentsPaused(getStore(user.email), paused);
    await audit(user, paused ? 'agent.pause-all' : 'agent.resume-all', undefined, { tenants: changed });
    return { ok: changed.length ? `${paused ? 'Paused' : 'Resumed'} the agent for ${changed.length} business(es).` : 'Nothing to change.', reload: true };
  } catch (e) {
    return failure(e);
  }
}

export async function rollbackAction(_prev: FormState, data: FormData): Promise<FormState> {
  const id = text(data, 'tenant');
  const user = await requireUser('tenants:lifecycle', id);
  try {
    await rollbackTenant(getStore(user.email), id, text(data, 'sha'));
    await audit(user, 'tenant.rollback', id, { sha: text(data, 'sha') });
    return { ok: 'Rolled back. The previous settings are restored as a new change.', reload: true };
  } catch (e) {
    return failure(e);
  }
}

export async function removeBusinessAction(_prev: FormState, data: FormData): Promise<FormState> {
  const id = text(data, 'tenant');
  const user = await requireUser('tenants:lifecycle', id);
  if (text(data, 'confirm') !== id) return { error: `Type the business id (${id}) to confirm.` };
  try {
    const files = await removeTenant(getStore(user.email), id);
    await audit(user, 'tenant.remove', id, { files: files.length });
  } catch (e) {
    return failure(e);
  }
  return { redirect: '/businesses' };
}
