# Setup: everything you need to provide

Nothing here is built to need your Mac. Once these are in place the platform runs on GitHub Actions, Cloudflare and a hosted database. Work top to bottom; each item says what it unlocks, so you can stop early and still have a working system.

Legend: **Secret** = GitHub repository secret (Settings, Secrets and variables, Actions). **Variable** = repository variable (same page, Variables tab). **Host** = environment variable on the dashboard host.

## 1. Decisions only you can make

| Decision | Why it matters | Where it goes |
|----------|----------------|---------------|
| Real domain and final brand name for each of the 3 seed businesses (`leadgen`, `social`, `esim`) | They ship as paused drafts on `*.example` domains | Dashboard, Businesses, Identity |
| Platform name and agency footer shown to clients | White-labeling | Dashboard, Settings, Branding |
| Byline policy per business (person, organization, team) | Shown on every article | Business tab, Author |
| Publish mode per business: approval first (default) or auto | Auto publishes with no human read | Controls tab. Optional rule: auto-approve below a risk score |
| Monthly budget cap per business (default $20) | Agent stops when reached | Controls tab |
| Where lead-form submissions go (email, webhook, sheet) | Contact forms are inert until set | Business tab, Integrations |
| Legal text (privacy, terms) | The platform will not invent legal terms; those pages do not exist until you supply text | Business tab, Legal |
| 15 to 25 real FAQs per business | Launch warning until present; none were written because none could be written without inventing facts | Business tab, FAQ |
| Wholesaler API details for `esim` (URL, auth, field names) or a CSV | The catalog is empty until a feed exists | Business tab, Integrations, feeds |
| Notification email addresses and reminder timing | Who is told about drafts, failures, budget | Dashboard, Settings, Notifications |
| Pricing for clients | Billing is usage export only; no prices are built in | Your invoicing tool |

## 2. Accounts and secrets

### GitHub (needed from the start)
- [ ] **Allow Actions to open pull requests**: repository Settings, Actions, General, tick "Allow GitHub Actions to create and approve pull requests". Without it the agent cannot open drafts.
- [ ] **Secret `AGENT_GITHUB_TOKEN`** (recommended): a fine-grained personal access token or GitHub App token, this repository only, with Contents, Pull requests, Actions and Workflows read/write. Pull requests opened with the built-in token do not trigger CI; this one does.
- [ ] **Dashboard token** (Host `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`): fine-grained, this repository only, Contents, Pull requests, Actions read/write. The dashboard uses it to commit config, merge drafts and start workflows.
- [ ] Optional: branch protection on `main` requiring the CI check, so only reviewed drafts reach production.

### Database (needed for the dashboard, agent, tracker)
- [ ] A hosted Postgres (Supabase, Neon or similar). **Secret `DATABASE_URL`** and **Host `DATABASE_URL`**. Migrations run automatically.

### Anthropic (needed for the agent and the Claude part of the tracker)
- [ ] **Secret `ANTHROPIC_API_KEY`**. Optional per-business keys: `ANTHROPIC_API_KEY__<ID>` with the id upper-cased and hyphens as underscores (`acme-dental` becomes `ANTHROPIC_API_KEY__ACME_DENTAL`). Each business then bills to its own key. A per-business key also needs a line in the workflow only if you want something other than the pattern already in `agent-daily.yml` (the pattern is already there).
- [ ] Variable `WEB_SEARCH_USD_PER_REQUEST` (optional): the price per web search, to keep the cost meter accurate. Default assumes $0.01.
- [ ] Check the model prices in `packages/llm/src/pricing.ts` against Anthropic's current price list. They are my assumptions. Unknown models are charged at the highest rate so the budget errs on the safe side. Override with the `MODEL_PRICING_JSON` secret.

### Cloudflare (needed to publish sites)
- [ ] **Secrets `CLOUDFLARE_API_TOKEN`** (Pages edit; add DNS edit if you let it manage records) and **`CLOUDFLARE_ACCOUNT_ID`**.
- [ ] Variable `CLOUDFLARE_PROJECT_PREFIX` (optional, default `avp`).
- [ ] Variable **`DEPLOY_ENABLED` = `true`** when ready. Until then deploys are skipped.
- [ ] Point each business's DNS at its Pages project.

### Switches (all default to off, so merging is safe)
- [ ] Variable **`AGENT_ENABLED` = `true`** turns on the daily agent, revisions, scheduled publishing, reminders and the weekly tracker.
- [ ] Variable `BILLING_ENABLED` = `true` turns on the monthly usage statement.

### Email (optional, needed for email notifications)
- [ ] **Secret `RESEND_API_KEY`**, **Host `RESEND_API_KEY`**, and Variable/Host **`NOTIFY_FROM`** (a verified sender). Without these, notifications still appear in the dashboard.

### AI visibility tracker (optional, add as many as you want)
- [ ] Claude uses the Anthropic key above. 
- [ ] **Secret `PERPLEXITY_API_KEY`** (adds Perplexity). Variable `PERPLEXITY_USD_PER_REQUEST` to set the assumed cost (default $0.01).
- [ ] **Secret `OPENAI_API_KEY`** (adds ChatGPT with web search). Variable `OPENAI_TRACKER_MODEL`: set the current model name yourself; the default is a guess. Variable `OPENAI_USD_PER_REQUEST` (default $0.03).
- [ ] Variable `TRACKER_MAX_USD`: most one business may cost in one weekly run (default $3).
- [ ] **Google Search Console** (optional): create an OAuth client, authorise it once for the account that owns the properties, then set Variable `GSC_CLIENT_ID`, Secrets `GSC_CLIENT_SECRET` and `GSC_REFRESH_TOKEN`, and set each business's Search Console property (`sc-domain:example.com`).

### Billing webhook (optional)
- [ ] Secrets `BILLING_WEBHOOK_URL` (https) and `BILLING_WEBHOOK_SECRET`. The monthly job POSTs per-business usage signed with HMAC-SHA256 in `X-AVP-Signature`. There is no payment provider integration; see DECISIONS.

## 3. Host the dashboard

The dashboard is a Next.js 15 app in `apps/dashboard` and needs a Node host. No deploy configuration is included; you choose the host.
- [ ] Pick a host that runs Node (Vercel, Render, Fly.io, Railway or similar). Build from the repository root with `pnpm install --frozen-lockfile && pnpm --filter @avp/dashboard build`, start with `pnpm --filter @avp/dashboard start`.
- [ ] Set Host variables: `DATABASE_URL`, `SESSION_SECRET` (32+ random characters), `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, optionally `RESEND_API_KEY`, `NOTIFY_FROM`.
- [ ] First run: set `SETUP_TOKEN`, open `/setup`, create the owner, scan the QR code, then remove `SETUP_TOKEN`.
- [ ] Put it on a domain you control over HTTPS.

## 4. Per business before launching
Use the Setup checklist tab in the dashboard; it lists exactly what is missing. Typical: real description and tagline, Arabic translations, FAQs, author bio, lead-form destination, legal text, tracker prompts, competitors, budget. Then press Launch.

## 5. First-week checks (I could not do these for you)
- Run the agent once with "Practice run" ticked and read the result before enabling schedules.
- Read the first few drafts closely, especially Arabic, against `docs/STATUS.md`.
- After two weeks open Costs and compare measured run time and spend with `docs/ACTIONS-USAGE.md`.
