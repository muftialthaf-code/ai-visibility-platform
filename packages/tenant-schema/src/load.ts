import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateTenant, type ValidationResult } from './validate.ts';

export function readTenantFile(tenantsDir: string, id: string): unknown {
  const file = join(tenantsDir, id, 'tenant.json');
  if (!existsSync(file)) throw new Error(`No tenant.json found for "${id}" in ${tenantsDir}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function loadTenant(tenantsDir: string, id: string): ValidationResult {
  const result = validateTenant(readTenantFile(tenantsDir, id));
  if (result.tenant && result.tenant.id !== id) {
    result.errors.push({ path: 'id', message: `id "${result.tenant.id}" must match its folder name "${id}"` });
    result.ok = false;
    result.tenant = undefined;
  }
  return result;
}

/** Tenant folder names. Folders starting with "_" (like _template) are not real tenants. */
export function listTenantIds(tenantsDir: string, opts: { includeTemplates?: boolean } = {}): string[] {
  return readdirSync(tenantsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(tenantsDir, d.name, 'tenant.json')))
    .map((d) => d.name)
    .filter((name) => opts.includeTemplates || !name.startsWith('_'))
    .sort();
}
