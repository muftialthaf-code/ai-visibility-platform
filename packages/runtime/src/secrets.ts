/** Environment variable name for a tenant-specific override: ANTHROPIC_API_KEY__ACME_DENTAL. */
export function tenantEnvKey(name: string, tenantId: string): string {
  return `${name}__${tenantId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export type Env = Record<string, string | undefined>;

/** Tenant override first, then the global value. Empty strings count as unset. */
export function getSecret(env: Env, name: string, tenantId?: string): string | undefined {
  if (tenantId) {
    const own = env[tenantEnvKey(name, tenantId)];
    if (own) return own;
  }
  return env[name] || undefined;
}

export function requireSecret(env: Env, name: string, tenantId?: string): string {
  const v = getSecret(env, name, tenantId);
  if (!v) {
    const hint = tenantId ? ` (or ${tenantEnvKey(name, tenantId)} for tenant ${tenantId})` : '';
    throw new Error(`Missing secret ${name}${hint}. Add it as a repository secret or host environment variable.`);
  }
  return v;
}

/** Replace any secret value found in text with a placeholder. Use before logging or storing output. */
export function redact(text: string, env: Env, names: string[] = SECRET_NAMES): string {
  let out = text;
  for (const [key, value] of Object.entries(env)) {
    const base = key.split('__')[0]!;
    if (value && value.length >= 8 && names.includes(base)) out = out.split(value).join(`[redacted:${key}]`);
  }
  return out;
}

/** Every secret the platform reads. Keep in sync with docs/SETUP.md. */
export const SECRET_NAMES = [
  'ANTHROPIC_API_KEY',
  'PERPLEXITY_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'SEARCH_API_KEY',
  'GITHUB_TOKEN',
  'AGENT_GITHUB_TOKEN',
  'DATABASE_URL',
  'RESEND_API_KEY',
  'SESSION_SECRET',
  'CLOUDFLARE_API_TOKEN',
  'GSC_CLIENT_SECRET',
  'GSC_REFRESH_TOKEN',
];
