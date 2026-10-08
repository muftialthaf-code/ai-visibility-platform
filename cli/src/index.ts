import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndexNowRequest } from '@avp/seo';
import { listTenantIds, loadTenant } from '@avp/tenant-schema';
import { FsStore, activeTenants, getTenant, runnableTenants } from '@avp/tenant-ops';
import { auditSite } from './audit.ts';
import { need, parseArgs, strFlag, type ParsedArgs } from './args.ts';
import { changedUrls, planDeploys, toMatrix } from './plan.ts';
import { feedCommand } from './feed.ts';
import { tenantCommand } from './tenant.ts';
import { billingCommand } from './billing.ts';
import { agentCommand, notifyCommand, publishDueCommand, trackerCommand } from './agent.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const tenantsDir = join(repoRoot, 'tenants');
const sitesDir = join(repoRoot, 'dist/sites');

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

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

function changedFiles(since: string): string[] {
  return git('diff', '--name-only', `${since}..HEAD`).split('\n').filter(Boolean);
}

type Command = (args: ParsedArgs, store: FsStore) => Promise<number>;

const commands: Record<string, Command> = {
  /** tenant <add|edit|pause|resume|remove|list|status|show|export|history|rollback> */
  async tenant(args, store) {
    const [sub, ...rest] = args.positional;
    return tenantCommand(sub, { ...args, positional: rest }, store);
  },

  /** agent <run|revise> ... */
  async agent(args, store) {
    const [sub, ...rest] = args.positional;
    return agentCommand({ ...args, positional: [sub ?? '', ...rest] }, store);
  },

  /** billing usage [--month] [--post] */
  async billing(args, store) {
    return billingCommand(args, store);
  },

  /** tracker run <tenant> */
  async tracker(args, store) {
    return trackerCommand(args, store);
  },

  /** publish-due: publish drafts whose scheduled time has come. */
  async 'publish-due'(args, store) {
    return publishDueCommand(args, store);
  },

  /** notify reminders */
  async notify(args, store) {
    return notifyCommand(args, store);
  },

  /** feed sync <tenant> */
  async feed(args, store) {
    const [sub, ...rest] = args.positional;
    return feedCommand(sub, { ...args, positional: rest }, store);
  },

  /** site build <tenant> */
  async site(args) {
    const [sub, id] = args.positional;
    if (sub !== 'build') {
      console.log('Usage: site build <tenant> [--staging]');
      return sub ? 1 : 0;
    }
    execFileSync('pnpm', ['--filter', '@avp/site', 'build'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, TENANT: need(id, 'tenant id'), ...(args.flags.staging ? { SITE_ENV: 'staging' } : {}) },
    });
    return 0;
  },

  /** Validate tenant configs. With no id, validates every tenant plus templates and fixtures. */
  async validate(args) {
    const id = args.positional[0];
    return validate(id ? [id] : listTenantIds(tenantsDir, { includeTemplates: true })) ? 0 : 1;
  },

  /** Audit built sites in dist/sites. */
  async audit(args) {
    const id = args.positional[0];
    const ids = id ? [id] : existsSync(sitesDir) ? readdirSync(sitesDir) : [];
    if (ids.length === 0) {
      console.log('No built sites found. Run `pnpm build:site` first.');
      return 1;
    }
    let ok = true;
    for (const t of ids) {
      const problems = auditSite(join(sitesDir, t));
      console.log(`${problems.length === 0 ? 'OK  ' : 'FAIL'} ${t}`);
      for (const p of problems) console.log(`  ${p}`);
      if (problems.length > 0) ok = false;
    }
    return ok ? 0 : 1;
  },

  /**
   * Print a GitHub Actions matrix.
   *   matrix --kind deploy [--changed-since <sha>]   active tenants to (re)deploy
   *   matrix --kind agent                           active tenants whose agent should run
   *   matrix --kind tracker                         active tenants with tracked prompts
   *   matrix --kind ci [--changed-since <sha>]      every tenant folder affected by a change
   */
  async matrix(args, store) {
    const kind = strFlag(args, 'kind') ?? 'deploy';
    if (kind === 'agent') {
      console.log(toMatrix(await runnableTenants(store)));
      return 0;
    }
    if (kind === 'tracker') {
      // Active businesses that have questions to track.
      const ids: string[] = [];
      for (const id of await activeTenants(store)) if ((await getTenant(store, id)).trackerPrompts.length > 0) ids.push(id);
      console.log(toMatrix(ids));
      return 0;
    }
    // "ci" covers every tenant folder (paused ones, templates and fixtures too); "deploy" only active tenants.
    const active = kind === 'ci' ? listTenantIds(tenantsDir, { includeTemplates: true }) : await activeTenants(store);
    const since = strFlag(args, 'changed-since');
    // An all-zeros "before" sha (first push of a branch) or a missing ref means: rebuild everything.
    const usable = since && !/^0+$/.test(since) ? since : undefined;
    let ids = active;
    if (usable) {
      try {
        ids = planDeploys(changedFiles(usable), active);
      } catch {
        ids = active;
      }
    }
    console.log(toMatrix(ids));
    return 0;
  },

  /** indexnow ping <tenant> [--urls a,b] [--changed-since <sha>] [--dry-run] */
  async indexnow(args, store) {
    const [sub, id] = args.positional;
    if (sub !== 'ping') {
      console.log('Usage: indexnow ping <tenant> [--urls a,b | --changed-since <sha>] [--dry-run]');
      return sub ? 1 : 0;
    }
    const tenant = await getTenant(store, need(id, 'tenant id'));
    const key = tenant.integrations.indexNowKey;
    if (!key) throw new Error(`${tenant.id} has no integrations.indexNowKey`);
    const siteUrl = process.env.SITE_URL ?? `https://${tenant.identity.domain}`;
    const explicit = strFlag(args, 'urls')?.split(',').map((s) => s.trim());
    const since = strFlag(args, 'changed-since');
    let urls = explicit ?? [];
    if (!explicit && since && !/^0+$/.test(since)) {
      try {
        urls = changedUrls(changedFiles(since), tenant.id, siteUrl, tenant.languages.default);
      } catch {
        urls = []; // unknown base commit: nothing to compare against
      }
    }
    if (urls.length === 0) {
      console.log('No URLs to submit.');
      return 0;
    }
    const req = buildIndexNowRequest(siteUrl, key, urls);
    if (args.flags['dry-run']) {
      console.log(JSON.stringify(req, null, 2));
      return 0;
    }
    const res = await fetch(req.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(req.body),
    });
    console.log(`IndexNow responded ${res.status} for ${req.body.urlList.length} URL(s)`);
    // 200 and 202 are success; 429 means slow down. Failures here must not fail a deploy.
    return 0;
  },
};

// Short aliases for the most common commands
commands.list = (args, store) => commands.tenant!({ ...args, positional: ['list', ...args.positional] }, store);

export function registerCommand(name: string, fn: Command) {
  commands[name] = fn;
}

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const store = new FsStore(repoRoot, { commit: Boolean(args.flags.commit) });
  const cmd = name ? commands[name] : undefined;
  if (!cmd) {
    console.log(`Usage: pnpm avp <${Object.keys(commands).join(' | ')}> [args]`);
    process.exit(name ? 1 : 0);
  }
  try {
    process.exit(await cmd(args, store));
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`);
    process.exit(1);
  }
}

await main();
