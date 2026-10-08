import { randomUUID } from 'node:crypto';
import { validateTenant, type Issue, type TenantConfig } from '@avp/tenant-schema';
import type { HistoryEntry, TenantStore } from './store.ts';

const TEMPLATE_ID = '_template';
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LANG_KEY = /^[a-z]{2,3}(-[A-Z]{2})?$/;

export class TenantOpError extends Error {
  constructor(
    message: string,
    public issues: Issue[] = [],
  ) {
    super(issues.length ? `${message}\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}` : message);
    this.name = 'TenantOpError';
  }
}

export const tenantFile = (id: string) => `tenants/${id}/tenant.json`;
const serialise = (data: unknown) => JSON.stringify(data, null, 2) + '\n';

export interface TenantSummary {
  id: string;
  valid: boolean;
  name?: string;
  domain?: string;
  status?: TenantConfig['status'];
  agentPaused?: boolean;
  publishMode?: TenantConfig['agent']['publishMode'];
  articlesPerDay?: number;
  monthlyBudgetUsd?: number;
  languages?: string[];
  errors: Issue[];
  warnings: Issue[];
}

/** Ids of real tenants (folders starting with "_" are templates and fixtures). */
export async function tenantIds(store: TenantStore): Promise<string[]> {
  const files = await store.listFiles('tenants/');
  const ids = new Set<string>();
  for (const f of files) {
    const m = /^tenants\/([^/]+)\/tenant\.json$/.exec(f);
    if (m && !m[1]!.startsWith('_')) ids.add(m[1]!);
  }
  return [...ids].sort();
}

async function readRaw(store: TenantStore, id: string): Promise<unknown> {
  const text = await store.readFile(tenantFile(id));
  if (text === null) throw new TenantOpError(`Tenant "${id}" does not exist`);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new TenantOpError(`tenants/${id}/tenant.json is not valid JSON: ${(e as Error).message}`);
  }
}

export async function getTenant(store: TenantStore, id: string): Promise<TenantConfig> {
  const result = validateTenant(await readRaw(store, id));
  if (!result.tenant) throw new TenantOpError(`Tenant "${id}" is invalid`, result.errors);
  return result.tenant;
}

export async function summariseTenant(store: TenantStore, id: string): Promise<TenantSummary> {
  let raw: unknown;
  try {
    raw = await readRaw(store, id);
  } catch (e) {
    return { id, valid: false, errors: [{ path: '', message: (e as Error).message }], warnings: [] };
  }
  const r = validateTenant(raw);
  const t = r.tenant;
  return {
    id,
    valid: r.ok,
    name: t?.identity.name,
    domain: t?.identity.domain,
    status: t?.status,
    agentPaused: t?.agent.paused,
    publishMode: t?.agent.publishMode,
    articlesPerDay: t?.agent.articlesPerDay,
    monthlyBudgetUsd: t?.agent.monthlyBudgetUsd,
    languages: t?.languages.supported,
    errors: r.errors,
    warnings: r.warnings,
  };
}

export async function listTenants(store: TenantStore): Promise<TenantSummary[]> {
  return Promise.all((await tenantIds(store)).map((id) => summariseTenant(store, id)));
}

export interface AddTenantInput {
  id: string;
  name: string;
  domain: string;
  defaultLanguage?: string;
  languages?: string[];
}

/** Apply fn to every string inside the config (used to swap the template's placeholder name). */
function mapStrings(node: unknown, fn: (s: string) => string): unknown {
  if (typeof node === 'string') return fn(node);
  if (Array.isArray(node)) return node.map((n) => mapStrings(n, fn));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, mapStrings(v, fn)]));
  }
  return node;
}

function isLocalized(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const e = Object.entries(v);
  return e.length > 0 && e.every(([k, val]) => LANG_KEY.test(k) && (typeof val === 'string' || Array.isArray(val)));
}

/** Reshape every translated field to exactly the requested languages. */
function reshapeLanguages(node: unknown, languages: string[], fallback: string): unknown {
  if (isLocalized(node)) {
    const base = node[fallback] ?? Object.values(node)[0];
    return Object.fromEntries(languages.map((l) => [l, node[l] ?? base]));
  }
  if (Array.isArray(node)) return node.map((n) => reshapeLanguages(n, languages, fallback));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, reshapeLanguages(v, languages, fallback)]));
  }
  return node;
}

/** Create a tenant from the blank template. New tenants always start paused. */
export async function addTenant(store: TenantStore, input: AddTenantInput): Promise<TenantConfig> {
  if (!ID_RE.test(input.id)) throw new TenantOpError(`Invalid id "${input.id}": use lowercase letters, numbers and hyphens`);
  if (await store.readFile(tenantFile(input.id))) throw new TenantOpError(`Tenant "${input.id}" already exists`);
  const templateText = await store.readFile(tenantFile(TEMPLATE_ID));
  if (!templateText) throw new TenantOpError(`Template tenants/${TEMPLATE_ID}/tenant.json is missing`);

  const languages = input.languages?.length ? input.languages : ['en', 'ar'];
  const defaultLanguage = input.defaultLanguage ?? languages[0]!;
  if (!languages.includes(defaultLanguage)) throw new TenantOpError('The default language must be one of the supported languages');

  let draft = JSON.parse(templateText) as Record<string, any>;
  const placeholder = draft.identity.name as string;
  draft = mapStrings(draft, (s) => s.split(placeholder).join(input.name)) as Record<string, any>;
  draft = reshapeLanguages(draft, languages, 'en') as Record<string, any>;
  draft.id = input.id;
  draft.status = 'paused';
  draft.identity.name = input.name;
  draft.identity.domain = input.domain;
  draft.languages = { default: defaultLanguage, supported: languages };
  draft.integrations = { ...draft.integrations, indexNowKey: randomUUID().replace(/-/g, '') };
  draft.agent = { ...draft.agent, paused: true };

  const result = validateTenant(draft);
  if (!result.tenant) throw new TenantOpError('The new tenant config is invalid', result.errors);

  await store.writeFiles([{ path: tenantFile(input.id), content: serialise(draft) }], `Add tenant ${input.id}`);
  return result.tenant;
}

/** Merge rules: objects merge key by key, arrays and scalars replace, null deletes the key. */
export function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch === null) return undefined;
  if (Array.isArray(patch) || typeof patch !== 'object') return patch;
  const out: Record<string, unknown> = base && typeof base === 'object' && !Array.isArray(base) ? { ...(base as object) } : {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const merged = deepMerge(out[k], v);
    if (merged === undefined) delete out[k];
    else out[k] = merged;
  }
  return out;
}

export interface UpdateResult {
  tenant: TenantConfig;
  warnings: Issue[];
}

/** Validate and save a change to a tenant's config. Nothing is written if validation fails. */
export async function updateTenant(
  store: TenantStore,
  id: string,
  change: Record<string, unknown> | ((current: any) => any),
  message?: string,
): Promise<UpdateResult> {
  const current = (await readRaw(store, id)) as Record<string, unknown>;
  const next = typeof change === 'function' ? change(structuredClone(current)) : deepMerge(current, change);
  if (!next || typeof next !== 'object') throw new TenantOpError('The change produced an invalid config');
  if ((next as any).id !== id) throw new TenantOpError('A tenant id cannot be changed. Create a new tenant instead.');

  const result = validateTenant(next);
  if (!result.tenant) throw new TenantOpError('Change rejected: the config would be invalid', result.errors);
  await store.writeFiles([{ path: tenantFile(id), content: serialise(next) }], message ?? `Update tenant ${id}`);
  return { tenant: result.tenant, warnings: result.warnings };
}

export const setStatus = (store: TenantStore, id: string, status: 'active' | 'paused') =>
  updateTenant(store, id, { status }, `${status === 'active' ? 'Resume' : 'Pause'} tenant ${id}`);

export const setAgentPaused = (store: TenantStore, id: string, paused: boolean) =>
  updateTenant(store, id, { agent: { paused } }, `${paused ? 'Pause' : 'Resume'} agent for ${id}`);

/** Every file that belongs to a tenant, as path to content. Used for export and before removal. */
export async function exportTenant(store: TenantStore, id: string): Promise<Record<string, string>> {
  const files = await store.listFiles(`tenants/${id}/`);
  if (files.length === 0) throw new TenantOpError(`Tenant "${id}" does not exist`);
  const out: Record<string, string> = {};
  for (const f of files) out[f] = (await store.readFile(f)) ?? '';
  return out;
}

/** Delete a tenant and all of its content. Export first if the data must be kept. */
export async function removeTenant(store: TenantStore, id: string): Promise<string[]> {
  if (id.startsWith('_')) throw new TenantOpError('Templates and fixtures cannot be removed with this command');
  const files = await store.listFiles(`tenants/${id}/`);
  if (files.length === 0) throw new TenantOpError(`Tenant "${id}" does not exist`);
  await store.writeFiles(files.map((path) => ({ path, content: null })), `Remove tenant ${id}`);
  return files;
}

export async function tenantHistory(store: TenantStore, id: string, limit = 20): Promise<HistoryEntry[]> {
  if (!store.history) throw new TenantOpError('This store does not keep history');
  return store.history(tenantFile(id), limit);
}

/** Restore a tenant's config to how it was at a past commit. The rollback is itself a new commit. */
export async function rollbackTenant(store: TenantStore, id: string, sha: string): Promise<UpdateResult> {
  if (!store.readFileAt) throw new TenantOpError('This store cannot read past versions');
  const old = await store.readFileAt(tenantFile(id), sha);
  if (old === null) throw new TenantOpError(`No version of ${tenantFile(id)} at ${sha}`);
  const result = validateTenant(JSON.parse(old));
  if (!result.tenant) throw new TenantOpError('That version is no longer valid under the current schema', result.errors);
  await store.writeFiles([{ path: tenantFile(id), content: serialise(JSON.parse(old)) }], `Roll back tenant ${id} to ${sha.slice(0, 7)}`);
  return { tenant: result.tenant, warnings: result.warnings };
}

/** Tenants the scheduler should act on: active, with the agent not paused. */
export async function runnableTenants(store: TenantStore): Promise<string[]> {
  const out: string[] = [];
  for (const s of await listTenants(store)) {
    if (s.valid && s.status === 'active' && !s.agentPaused && (s.articlesPerDay ?? 0) > 0) out.push(s.id);
  }
  return out;
}

export async function activeTenants(store: TenantStore): Promise<string[]> {
  return (await listTenants(store)).filter((s) => s.valid && s.status === 'active').map((s) => s.id);
}
