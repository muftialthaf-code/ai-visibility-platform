import { AnthropicLlm, UsageMeter, pricingFromEnv } from '@avp/llm';
import { connect, getSetting, migrate } from '@avp/db';
import { GitHubClient } from '@avp/github';
import { DEFAULT_GLOBALS, DEFAULT_NOTIFICATIONS, parseGlobals, parseNotifications, requireSecret } from '@avp/runtime';
import { publishDue, remindStaleDrafts, reviseDraft, runAgent, type AgentContext } from '@avp/agent';
import { getTenant, type TenantStore } from '@avp/tenant-ops';
import { need, strFlag, type ParsedArgs } from './args.ts';

function github(env: NodeJS.ProcessEnv): GitHubClient {
  const repo = env.GITHUB_REPOSITORY ?? '';
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error('GITHUB_REPOSITORY must be set to "owner/repo".');
  const token = env.AGENT_GITHUB_TOKEN || env.GITHUB_TOKEN;
  if (!token) throw new Error('Set AGENT_GITHUB_TOKEN (or GITHUB_TOKEN) so the agent can open pull requests.');
  return new GitHubClient({ token, owner, repo: name, branch: env.PRODUCTION_BRANCH || 'main' });
}

async function database(env: NodeJS.ProcessEnv) {
  const db = await connect(requireSecret(env, 'DATABASE_URL'));
  await migrate(db);
  return db;
}

async function contextFor(tenantId: string, store: TenantStore, env: NodeJS.ProcessEnv, dryRun: boolean): Promise<AgentContext & { close: () => Promise<void> }> {
  const tenant = await getTenant(store, tenantId);
  const db = await database(env);
  const globals = parseGlobals(await getSetting(db, 'defaults', DEFAULT_GLOBALS));
  const notifications = parseNotifications(await getSetting(db, 'notifications', DEFAULT_NOTIFICATIONS));
  const meter = new UsageMeter({ pricing: pricingFromEnv(env) });
  // A tenant can have its own Anthropic key so its usage is billed separately.
  const llm = new AnthropicLlm({ apiKey: requireSecret(env, 'ANTHROPIC_API_KEY', tenantId), models: { author: globals.authorModel, judge: globals.judgeModel }, meter });
  return {
    tenant,
    llm,
    db,
    gh: dryRun && !env.GITHUB_REPOSITORY ? (undefined as unknown as GitHubClient) : github(env),
    store,
    globals,
    notifications,
    siteUrl: env.SITE_URL ?? `https://${tenant.identity.domain}`,
    now: () => new Date(),
    log: (m) => console.log(m),
    env,
    close: () => db.close(),
  };
}

const runUrl = (env: NodeJS.ProcessEnv) => (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined);

/** agent run <tenant> [--trigger schedule|manual|retry] [--dry-run]   |   agent revise <tenant> <pr> --instructions "..." */
export async function agentCommand(args: ParsedArgs, store: TenantStore, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const [sub, id, pr] = args.positional;
  if (sub === 'run') {
    const tenantId = need(id, 'tenant id');
    const trigger = (strFlag(args, 'trigger') ?? 'manual') as 'schedule' | 'manual' | 'retry';
    if (!['schedule', 'manual', 'retry'].includes(trigger)) throw new Error('--trigger must be schedule, manual or retry');
    const ctx = await contextFor(tenantId, store, env, Boolean(args.flags['dry-run']));
    try {
      const results = await runAgent(ctx, { trigger, dryRun: Boolean(args.flags['dry-run']), githubRunUrl: runUrl(env) });
      for (const r of results) {
        console.log(`${tenantId}: ${r.status}${r.topic ? ` | ${r.topic}` : ''}${r.prNumber ? ` | PR ${r.prNumber}` : ''}${r.articleUrl ? ` | ${r.articleUrl}` : ''}${r.error ? ` | ${r.error}` : ''}`);
        for (const c of r.checks.filter((c) => !c.passed)) console.log(`  check failed (${c.lang}): ${c.label}${c.reason ? ` - ${c.reason}` : ''}`);
      }
      // A failed run is a failed job so it shows red in Actions. A held draft or a skip is a normal outcome.
      return results.some((r) => r.status === 'failed') ? 1 : 0;
    } finally {
      await ctx.close();
    }
  }
  if (sub === 'revise') {
    const instructions = strFlag(args, 'instructions');
    if (!instructions) throw new Error('Usage: agent revise <tenant> <pr number> --instructions "what to change"');
    const ctx = await contextFor(need(id, 'tenant id'), store, env, false);
    try {
      const next = await reviseDraft(ctx, Number(need(pr, 'pull request number')), instructions, 'dashboard');
      console.log(`Revised to revision ${next.revision}. Checks ${next.gatesPassed ? 'pass' : 'still fail'}.`);
      return 0;
    } finally {
      await ctx.close();
    }
  }
  console.log('Usage: agent run <tenant> [--trigger schedule|manual|retry] [--dry-run]\n       agent revise <tenant> <pr> --instructions "..."');
  return sub ? 1 : 0;
}

/** publish-due: merge drafts whose scheduled time has come. */
export async function publishDueCommand(_args: ParsedArgs, _store: TenantStore, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const db = await database(env);
  try {
    const r = await publishDue({ db, gh: github(env), log: (m) => console.log(m) });
    console.log(`Published ${r.published} scheduled draft(s); ${r.failed} failed.`);
    return r.failed > 0 ? 1 : 0;
  } finally {
    await db.close();
  }
}

/** notify reminders: remind about drafts nobody has reviewed. */
export async function notifyCommand(args: ParsedArgs, _store: TenantStore, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (args.positional[0] !== 'reminders') {
    console.log('Usage: notify reminders');
    return args.positional[0] ? 1 : 0;
  }
  const db = await database(env);
  try {
    const settings = parseNotifications(await getSetting(db, 'notifications', DEFAULT_NOTIFICATIONS));
    const sent = await remindStaleDrafts({ db, gh: github(env), settings, env });
    console.log(`Sent ${sent} reminder(s).`);
    return 0;
  } finally {
    await db.close();
  }
}

