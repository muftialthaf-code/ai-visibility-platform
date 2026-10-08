import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTenantIds, loadTenant } from '@avp/tenant-schema';
import { auditSite } from './audit.ts';

const tenantsDir = fileURLToPath(new URL('../../tenants', import.meta.url));
const [command, target] = process.argv.slice(2);

function validate(ids: string[]): boolean {
  let allOk = true;
  for (const id of ids) {
    const r = loadTenant(tenantsDir, id);
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${id}`);
    for (const e of r.errors) console.log(`  error   ${e.path}: ${e.message}`);
    for (const w of r.warnings) console.log(`  warning ${w.path}: ${w.message}`);
    if (!r.ok) allOk = false;
  }
  return allOk;
}

switch (command) {
  case 'list':
    for (const id of listTenantIds(tenantsDir)) {
      const r = loadTenant(tenantsDir, id);
      console.log(`${id}\t${r.tenant?.status ?? 'invalid'}`);
    }
    break;
  case 'validate': {
    // With no target, validate every tenant plus the blank template.
    const ids = target ? [target] : listTenantIds(tenantsDir, { includeTemplates: true });
    process.exit(validate(ids) ? 0 : 1);
    break;
  }
  case 'audit': {
    // Audit built sites in dist/sites. With no target, audit every built site.
    const sitesDir = fileURLToPath(new URL('../../dist/sites', import.meta.url));
    const ids = target ? [target] : existsSync(sitesDir) ? readdirSync(sitesDir) : [];
    if (ids.length === 0) {
      console.log('No built sites found. Run `pnpm build:site` first.');
      process.exit(1);
    }
    let allOk = true;
    for (const id of ids) {
      const problems = auditSite(join(sitesDir, id));
      console.log(`${problems.length === 0 ? 'OK  ' : 'FAIL'} ${id}`);
      for (const p of problems) console.log(`  ${p}`);
      if (problems.length > 0) allOk = false;
    }
    process.exit(allOk ? 0 : 1);
    break;
  }
  default:
    console.log('Usage: tsx cli/src/index.ts <list | validate [tenant-id] | audit [tenant-id]>');
    process.exit(command ? 1 : 0);
}
