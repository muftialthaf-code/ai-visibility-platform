import { AnthropicLlm, UsageMeter, pricingFromEnv } from '@avp/llm';
import { connect, getSetting, migrate } from '@avp/db';
import { GitHubClient } from '@avp/github';
import { DEFAULT_GLOBALS, DEFAULT_NOTIFICATIONS, getSecret, parseGlobals, parseNotifications, requireSecret } from '@avp/runtime';
import { notify, publishDue, remindStaleDrafts, reviseDraft, runAgent, type AgentContext } from '@avp/agent';
import { claudeProvider, fetchSearchConsoleWeek, openaiProvider, perplexityProvider, runTracker, weekStart, type AnswerProvider } from '@avp/tracker';
import { saveSearchConsoleWeek } from '@avp/db';
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


/** tracker run <tenant> [--trigger schedule|manual] — ask the AI assistants the tracked questions and record the answers. */
export async function trackerCommand(args: ParsedArgs, store: TenantStore, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const [sub, id] = args.positional;
  if (sub !== 'run') {
    console.log('Usage: tracker run <tenant> [--trigger schedule|manual]');
    return sub ? 1 : 0;
  }
  const tenantId = need(id, 'tenant id');
  const trigger = (strFlag(args, 'trigger') ?? 'manual') as 'schedule' | 'manual' | 'retry';
  const tenant = await getTenant(store, tenantId);
  const db = await database(env);
  try {
    const globals = parseGlobals(await getSetting(db, 'defaults', DEFAULT_GLOBALS));
    const settings = parseNotifications(await getSetting(db, 'notifications', DEFAULT_NOTIFICATIONS));
    const perRequest = (name: string, fallback: number) => {
      const n = Number(env[name]);
      return Number.isFinite(n) && n >= 0 && env[name] ? n : fallback;
    };
    const providers: AnswerProvider[] = [];
    const claudeKey = getSecret(env, 'ANTHROPIC_API_KEY', tenantId);
    if (claudeKey) providers.push(claudeProvider(new AnthropicLlm({ apiKey: claudeKey, models: { author: globals.authorModel, judge: globals.judgeModel }, meter: new UsageMeter({ pricing: pricingFromEnv(env) }) })));
    const pplx = getSecret(env, 'PERPLEXITY_API_KEY', tenantId);
    if (pplx) providers.push(perplexityProvider({ apiKey: pplx, usdPerRequest: perRequest('PERPLEXITY_USD_PER_REQUEST', 0.01) }));
    const openai = getSecret(env, 'OPENAI_API_KEY', tenantId);
    if (openai) providers.push(openaiProvider({ apiKey: openai, model: env.OPENAI_TRACKER_MODEL || 'gpt-5', usdPerRequest: perRequest('OPENAI_USD_PER_REQUEST', 0.03) }));

    const result = await runTracker(
      {
        tenant,
        db,
        providers,
        now: () => new Date(),
        log: (m) => console.log(m),
        maxUsd: perRequest('TRACKER_MAX_USD', 3),
        maxPrompts: 40,
        notify: async (n) => notify({ db, settings, env }, n),
      },
      { trigger, githubRunUrl: runUrl(env) },
    );
    console.log(`${tenantId}: ${result.status} | asked ${result.asked}, mentioned ${result.mentioned}, cited ${result.cited}, errors ${result.errors}, $${result.costUsd.toFixed(2)}${result.error ? ` | ${result.error}` : ''}`);

    // Search Console is optional: it runs only when its credentials and the property are set.
    const gscId = env.GSC_CLIENT_ID;
    const gscSecret = getSecret(env, 'GSC_CLIENT_SECRET', tenantId);
    const gscToken = getSecret(env, 'GSC_REFRESH_TOKEN', tenantId);
    const property = tenant.integrations.searchConsoleProperty;
    if (gscId && gscSecret && gscToken && property) {
      try {
        // The previous full week: Search Console data lags by a couple of days.
        const last = weekStart(new Date(Date.now() - 7 * 86400_000));
        const w = await fetchSearchConsoleWeek({ clientId: gscId, clientSecret: gscSecret, refreshToken: gscToken }, property, last);
        await saveSearchConsoleWeek(db, { tenantId, week: last, ...w });
        console.log(`Search Console: ${w.clicks} clicks, ${w.impressions} impressions for the week of ${last}.`);
      } catch (e) {
        console.log(`Search Console could not be read: ${(e as Error).message}`);
      }
    }
    return result.status === 'failed' ? 1 : 0;
  } finally {
    await db.close();
  }
}
