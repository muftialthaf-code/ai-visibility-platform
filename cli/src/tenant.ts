import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  addTenant,
  deepMerge,
  exportTenant,
  getTenant,
  listTenants,
  removeTenant,
  rollbackTenant,
  setAgentPaused,
  setStatus,
  summariseTenant,
  tenantHistory,
  updateTenant,
  type TenantStore,
} from '@avp/tenant-ops';
import { need, strFlag, type ParsedArgs } from './args.ts';

const print = (s = '') => console.log(s);

function printWarnings(warnings: Array<{ path: string; message: string }>) {
  for (const w of warnings) print(`  warning ${w.path}: ${w.message}`);
}

/** Parse "a.b.c=value" into a nested patch. Values are JSON when they parse, otherwise strings. */
export function setToPatch(expr: string): Record<string, unknown> {
  const eq = expr.indexOf('=');
  if (eq < 1) throw new Error(`--set expects path=value, got "${expr}"`);
  const path = expr.slice(0, eq).split('.');
  const raw = expr.slice(eq + 1);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  return path.reduceRight<unknown>((acc, key) => ({ [key]: acc }), value) as Record<string, unknown>;
}

export async function tenantCommand(sub: string | undefined, args: ParsedArgs, store: TenantStore): Promise<number> {
  const id = args.positional[0];
  switch (sub) {
    case 'add': {
      const languages = strFlag(args, 'languages')?.split(',').map((s) => s.trim());
      const t = await addTenant(store, {
        id: need(id, 'tenant id'),
        name: need(strFlag(args, 'name'), '--name'),
        domain: need(strFlag(args, 'domain'), '--domain'),
        languages,
        defaultLanguage: strFlag(args, 'default'),
      });
      print(`Created tenants/${t.id}/tenant.json (paused). Fill it in, then run: tenant resume ${t.id}`);
      return 0;
    }
    case 'edit': {
      const patches: Record<string, unknown>[] = [];
      for (const expr of args.all.set ?? []) patches.push(setToPatch(expr));
      const file = strFlag(args, 'file');
      if (file) patches.push(JSON.parse(readFileSync(file, 'utf8')));
      const inline = strFlag(args, 'patch');
      if (inline) patches.push(JSON.parse(inline));
      if (patches.length === 0) throw new Error('Nothing to change. Use --set path=value, --patch <json> or --file <patch.json>');
      const r = await updateTenant(store, need(id, 'tenant id'), (current) => {
        let next = current;
        for (const p of patches) next = deepMerge(next, p);
        return next;
      });
      print(`Updated ${r.tenant.id}.`);
      printWarnings(r.warnings);
      return 0;
    }
    case 'pause':
    case 'resume': {
      const tid = need(id, 'tenant id');
      if (args.flags.agent) {
        await setAgentPaused(store, tid, sub === 'pause');
        print(`Agent ${sub === 'pause' ? 'paused' : 'resumed'} for ${tid}.`);
      } else {
        const r = await setStatus(store, tid, sub === 'pause' ? 'paused' : 'active');
        print(`${tid} is now ${r.tenant.status}.`);
        printWarnings(r.warnings);
      }
      return 0;
    }
    case 'remove': {
      const tid = need(id, 'tenant id');
      if (!args.flags.yes) throw new Error(`This permanently deletes all of tenants/${tid}. Re-run with --yes to confirm (export first with: tenant export ${tid} <file>).`);
      const files = await removeTenant(store, tid);
      print(`Removed ${files.length} file(s) for ${tid}.`);
      return 0;
    }
    case 'list': {
      const list = await listTenants(store);
      if (args.flags.json) print(JSON.stringify(list, null, 2));
      else for (const s of list) print(`${s.id}\t${s.valid ? (s.status ?? '') : 'INVALID'}\t${s.agentPaused ? 'agent paused' : 'agent on'}\t${s.domain ?? ''}`);
      return 0;
    }
    case 'status': {
      const s = await summariseTenant(store, need(id, 'tenant id'));
      print(JSON.stringify(s, null, 2));
      return s.valid ? 0 : 1;
    }
    case 'export': {
      const tid = need(id, 'tenant id');
      const out = resolve(need(args.positional[1], 'output file, e.g. acme.tar.gz'));
      const bundle = await exportTenant(store, tid);
      const tmp = mkdtempSync(join(tmpdir(), 'avp-export-'));
      for (const [path, content] of Object.entries(bundle)) {
        mkdirSync(dirname(join(tmp, path)), { recursive: true });
        writeFileSync(join(tmp, path), content);
      }
      execFileSync('tar', ['-czf', out, '-C', tmp, `tenants/${tid}`]);
      print(`Exported ${Object.keys(bundle).length} file(s) to ${out}`);
      return 0;
    }
    case 'history': {
      for (const h of await tenantHistory(store, need(id, 'tenant id'))) print(`${h.sha.slice(0, 7)}  ${h.date.slice(0, 10)}  ${h.author}  ${h.message}`);
      return 0;
    }
    case 'rollback': {
      const r = await rollbackTenant(store, need(id, 'tenant id'), need(args.positional[1], 'commit sha'));
      print(`Rolled ${r.tenant.id} back.`);
      printWarnings(r.warnings);
      return 0;
    }
    case 'show': {
      print(JSON.stringify(await getTenant(store, need(id, 'tenant id')), null, 2));
      return 0;
    }
    default:
      print('Usage: tenant <add|edit|pause|resume|remove|list|status|show|export|history|rollback> ...');
      return sub ? 1 : 0;
  }
}

