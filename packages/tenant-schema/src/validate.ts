import { tenantSchema, type TenantConfig } from './schema.ts';

export interface Issue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  tenant?: TenantConfig;
  errors: Issue[];
  warnings: Issue[];
}

const LANG_KEY = /^[a-z]{2,3}(-[A-Z]{2})?$/;

function isLocalizedObject(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  return (
    entries.length > 0 &&
    entries.every(([k, val]) => LANG_KEY.test(k) && (typeof val === 'string' || Array.isArray(val)))
  );
}

/** Walk the config and call fn for every localized object ({ en: ..., ar: ... }). */
function walkLocalized(node: unknown, path: string, fn: (value: Record<string, unknown>, path: string) => void) {
  if (isLocalizedObject(node)) {
    fn(node, path);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkLocalized(item, `${path}[${i}]`, fn));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) walkLocalized(v, path ? `${path}.${k}` : k, fn);
  }
}

/**
 * Text the blank template ships with. A business that is switched to active while any of this is still
 * in its config would publish template instructions to the public, so that blocks launching.
 */
export const PLACEHOLDER_MARKERS = [
  'one sentence that says what you do',
  'describe what the business does',
  'describe who this business serves',
  'a short description of this service',
  'explain how pricing works',
  'a short, real description of who writes',
  'replace this with a direct answer',
  'example business',
];

/**
 * FAQ answer length target in words. Arabic needs fewer words than English for the same content,
 * so its window is lower. Other languages use the English window.
 */
export function faqWordRange(lang: string): [number, number] {
  return lang.split('-')[0] === 'ar' ? [30, 60] : [40, 60];
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => collectStrings(n, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((n) => collectStrings(n, out));
  return out;
}

/**
 * Validate a raw tenant config. Errors block saving; warnings are launch-readiness
 * advice (they only apply to tenants with status "active").
 */
export function validateTenant(raw: unknown): ValidationResult {
  const parsed = tenantSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      warnings: [],
    };
  }

  const tenant = parsed.data;
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const supported = tenant.languages.supported;

  // Every translated string must only use supported languages.
  walkLocalized(tenant, '', (value, path) => {
    for (const lang of Object.keys(value)) {
      if (!supported.includes(lang)) {
        errors.push({ path, message: `Uses language "${lang}", which is not in languages.supported` });
      }
    }
    if (tenant.status === 'active') {
      for (const lang of supported) {
        if (!(lang in value)) warnings.push({ path, message: `Missing "${lang}" translation` });
      }
    }
  });

  // Banned claims must not appear in the tenant's own copy.
  const banned = [...tenant.voice.bannedClaims, ...tenant.compliance.neverClaim].map((b) => b.toLowerCase());
  if (banned.length > 0) {
    const copy: Array<[string, unknown]> = [
      ['identity.tagline', tenant.identity.tagline],
      ['profile', tenant.profile],
      ['faq', tenant.faq],
    ];
    for (const [path, node] of copy) {
      for (const text of collectStrings(node)) {
        const hit = banned.find((b) => text.toLowerCase().includes(b));
        if (hit) errors.push({ path, message: `Contains banned claim "${hit}"` });
      }
    }
  }

  if (tenant.status === 'active') {
    // Template placeholder text must never go live.
    const everything: Array<[string, unknown]> = [
      ['identity', tenant.identity],
      ['profile', tenant.profile],
      ['faq', tenant.faq],
      ['author', tenant.author],
      ['voice', tenant.voice],
      ['legal', tenant.legal],
    ];
    for (const [path, node] of everything) {
      for (const text of collectStrings(node)) {
        const hit = PLACEHOLDER_MARKERS.find((m) => text.toLowerCase().includes(m));
        if (hit) errors.push({ path, message: `Still contains template placeholder text ("${text.slice(0, 60)}"). Replace it before launching.` });
      }
    }
    if (tenant.faq.length < 15 || tenant.faq.length > 25) {
      warnings.push({ path: 'faq', message: `Active tenants should have 15 to 25 FAQs (found ${tenant.faq.length})` });
    }
    tenant.faq.forEach((item, i) => {
      for (const [lang, answer] of Object.entries(item.answer)) {
        const words = wordCount(answer);
        const [min, max] = faqWordRange(lang);
        if (words < min || words > max) {
          warnings.push({ path: `faq[${i}].answer.${lang}`, message: `FAQ answers should be ${min} to ${max} words in ${lang} (found ${words})` });
        }
      }
    });
    if (tenant.trackerPrompts.length === 0) {
      warnings.push({ path: 'trackerPrompts', message: 'No tracker prompts, so AI visibility cannot be measured' });
    }
    if (tenant.agent.articlesPerDay > 0 && tenant.agent.monthlyBudgetUsd === 0) {
      warnings.push({ path: 'agent.monthlyBudgetUsd', message: 'Agent is enabled with no monthly budget cap' });
    }
  }

  return { ok: errors.length === 0, tenant: errors.length === 0 ? tenant : undefined, errors, warnings };
}
