import { defineConfig } from 'astro/config';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// One build per tenant: TENANT=<folder name under /tenants>. Defaults to the blank template.
const tenantId = process.env.TENANT ?? '_template';
const tenantsDir = resolve(process.env.TENANTS_DIR ?? resolve(process.cwd(), '../../tenants'));
const file = resolve(tenantsDir, tenantId, 'tenant.json');
if (!existsSync(file)) throw new Error(`No tenant.json for "${tenantId}" in ${tenantsDir}`);
const domain = JSON.parse(readFileSync(file, 'utf8')).identity.domain;

export default defineConfig({
  site: (process.env.SITE_URL ?? `https://${domain}`).replace(/\/$/, ''),
  output: 'static',
  trailingSlash: 'always',
  outDir: resolve(process.cwd(), '../../dist/sites', tenantId),
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});
