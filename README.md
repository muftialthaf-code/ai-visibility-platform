# AI Search Visibility Platform

A multi-tenant platform that makes any business easy for AI assistants and search engines to find, understand and recommend (AEO and GEO). Each business is a **tenant**: one config bundle in `/tenants/<id>`, from which the platform builds a complete, crawlable website. Nothing about any specific business is hardcoded in platform code.

**Status: all eight phases built.** Read [docs/STATUS.md](docs/STATUS.md) for what is verified and what has never run against a real service, [docs/SETUP.md](docs/SETUP.md) for everything you need to provide, and [docs/DECISIONS.md](docs/DECISIONS.md) for the choices made.

## Requirements

- Node 22 or newer
- pnpm 10 (`corepack enable` picks up the version pinned in `package.json`)

## Quick start

```bash
pnpm install
pnpm test                  # unit tests for the schema and SEO package
pnpm tenant:validate       # validate every tenant config
pnpm build:site            # build the blank template site into dist/sites/_template
pnpm audit:site            # check the built HTML against the AEO/GEO requirements
```

Build a different tenant with `TENANT=<folder name> pnpm build:site`. Preview with `pnpm --filter @avp/site dev` (set `TENANT` the same way).

## The `avp` command

```bash
pnpm avp tenant list [--json]
pnpm avp tenant add <id> --name "Acme Dental" --domain acme.example [--languages en,ar] [--default en]
pnpm avp tenant edit <id> --set agent.articlesPerDay=2 --set agent.monthlyBudgetUsd=30   # or --patch '<json>' / --file patch.json
pnpm avp tenant pause <id>            # take the site out of scheduled deploys
pnpm avp tenant resume <id>           # make it active (prints launch-readiness warnings)
pnpm avp tenant pause <id> --agent    # pause only the article agent (resume with --agent too)
pnpm avp tenant status <id>           # validation, state and warnings as JSON
pnpm avp tenant export <id> acme.tar.gz
pnpm avp tenant remove <id> --yes     # deletes the tenant folder; export first
pnpm avp tenant history <id>          # config history from git
pnpm avp tenant rollback <id> <sha>   # restore an earlier config as a new commit
pnpm avp site build <id> [--staging]
pnpm avp validate [id]                # schema and banned-claim checks
pnpm avp audit [id]                   # AEO/GEO checks on a built site
pnpm avp matrix --kind deploy|agent|ci [--changed-since <sha>]   # GitHub Actions matrices
pnpm avp feed sync <id> [--dry-run]    # rebuild data/catalog.json from the tenant's feeds
pnpm avp indexnow ping <id> --urls <a,b> [--dry-run]
```

Add `--commit` to any command that changes tenants to commit the change in git. Every change is validated first, and nothing is written if validation fails.

## The control dashboard

`apps/dashboard` is a Next.js app with its own sign-in (email, password and an authenticator app). It reads and writes tenant configs through the GitHub API, so every change is a validated commit, and keeps run history, costs and the audit log in a Postgres database.

**What it does today:** overview with health, alerts and spend; add, edit, launch, pause and remove businesses (forms for every setting, a setup checklist, version history with rollback, JSON export); pause or resume every agent at once; run history; users and roles; global defaults; notification preferences; connection status; audit log.

**Sign-in and roles.** Owners must turn on 2FA at first sign-in. Failed sign-ins lock an account for 15 minutes after 5 tries, and a 2FA code cannot be used twice. Roles are owner, editor, reviewer and client; the permission table is in `apps/dashboard/src/lib/permissions.ts`. Only the owner exists as a practical role until the review and client features arrive.

**First run (no terminal needed).** Set `SETUP_TOKEN` on the host, open `/setup`, create the owner, and scan the QR code. Or run `DATABASE_URL=... pnpm --filter @avp/dashboard create-owner you@example.com 'a-long-passphrase'`.

**Configuration** (host environment variables, never committed):

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection string (Supabase, Neon or similar). |
| `SESSION_SECRET` | Random string of 32 or more characters that signs session cookies. |
| `SETUP_TOKEN` | Enables the one-time `/setup` page. Remove it after the owner exists. |
| `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` | A fine-grained token with Contents, Pull requests and Actions read/write on this repository only. |
| `RESEND_API_KEY`, `NOTIFY_FROM` | Email notifications (used from Phase 5). |

**Local development:** `AVP_DEV_FS=1 pnpm --filter @avp/dashboard dev` runs against the checked-out repo and a local database in `.data/` (no GitHub or Postgres needed). Never set `AVP_DEV_FS` in production.

**Tests:** `pnpm --filter @avp/dashboard test` (unit) and `pnpm --filter @avp/dashboard e2e` (Playwright, drives the production build against an in-memory fake GitHub; build first with `pnpm --filter @avp/dashboard build`).

## Daily operation

- **Article agent** (`.github/workflows/agent-daily.yml`, 05:17 UTC): for each active business with the agent running, finds a topic, researches it with web search, writes an article per configured language, runs the quality checks, and opens a pull request labelled `article`, `tenant:<id>` and `gates:passed` or `gates:failed`. Manual: `pnpm avp agent run <id> [--dry-run]`, or "Write an article now" on the business page.
- **Review queue** (dashboard, Review): read the draft, see each check, edit it, ask the agent to rewrite it (`agent-revise.yml`), reject it (the agent avoids similar topics), schedule it, or approve it. Approving merges the pull request, which deploys the site. Drafts whose checks all passed can be approved in bulk.
- **Topics** (dashboard, Topics): the backlog; add your own and they go first.
- **Tracker** (`tracker-weekly.yml`, Mondays 06:43 UTC): asks each assistant the business's tracked questions, records mentions, citations and competitors. Manual: `pnpm avp tracker run <id>`. Reports: dashboard, Reports (trend, by question, competitors, CSV, print to PDF).
- **Costs and alerts**: Costs shows spend, budget and measured run time per business; Notifications lists every alert. Budget warning at the configured percentage; the agent stops at the cap.
- **Clients**: Clients creates single-use onboarding links; Settings, Users adds a Client login that only sees its own report; Settings, Branding sets the name and report footer.
- **Billing**: `pnpm avp billing usage --month 2026-10 [--post]` and Costs, export: usage per business, not prices.
- **Pause**: pause one business or its agent on its Controls tab, or pause every agent at once on Businesses.

Switches: nothing scheduled runs until the repository variable `AGENT_ENABLED` is `true`; deploys need `DEPLOY_ENABLED`; billing needs `BILLING_ENABLED`.

## Plan catalog module (for stores such as the eSIM tenant)

Switch it on with `site.modules.catalog` (and `site.modules.locations` for a page per destination). The site shows a plans table, one page per plan with `Product` and `Offer` schema, and destination pages. Nothing is published until `tenants/<id>/data/catalog.json` has plans.

**Sites never call the supplier.** `pnpm avp feed sync <id>` builds `data/catalog.json` from the tenant's feeds and commits it, so a build needs no supplier credentials and a supplier outage cannot break a deploy. Bad rows are skipped and reported. A feed where every row is invalid is refused, so a broken supplier response cannot wipe a live catalog.

**CSV feed:** put `tenants/<id>/data/<feedId>.csv` in the repository with the columns `id, name, destination, data_gb, validity_days, price, currency, url` (`data_gb` may be `unlimited`; `id` and `url` are optional). Declare it as `{ "id": "plans", "type": "csv" }`.

**API feed:**

```json
{
  "id": "wholesaler",
  "type": "api",
  "url": "https://supplier.example/v1/plans",
  "secretName": "SUPPLIER_API_KEY",
  "authHeader": "Authorization",
  "authScheme": "Bearer",
  "mapping": {
    "itemsPath": "data.plans",
    "fields": { "id": "sku", "name": "title", "destination": "country", "dataGb": "gb", "validityDays": "days", "price": "cost", "currency": "cur" }
  }
}
```

The key is read from the `secretName` environment variable (or `SUPPLIER_API_KEY__<TENANT_ID>` for a tenant-specific key). Add a `site.catalogNote` for the coverage or compatibility line shown under prices.

## Repository layout

| Path | What it is |
|------|------------|
| `tenants/_template` | Blank tenant bundle. Copy it to start a new business. |
| `tenants/<id>/tenant.json` | The tenant's whole config (schema below). |
| `tenants/_fixture-clinic` | CI test fixture. Proves a differently configured tenant builds with zero code changes. Never deployed. |
| `tenants/<id>/articles/<lang>/*.md` | Published articles for that tenant, one folder per language. |
| `packages/tenant-schema` | Config schema (Zod), validation and loaders. |
| `packages/seo` | JSON-LD builders and validator, `robots.txt`, sitemap with hreflang, `llms.txt`, AI-referrer tracking. |
| `apps/site` | The Astro site template, themed by tenant config. |
| `apps/dashboard` | The control dashboard (Next.js). |
| `packages/db` | Postgres access and migrations (users, audit log, runs, usage, settings). |
| `packages/github` | GitHub client, the tenant store used by the dashboard, and an in-memory fake GitHub for tests. |
| `packages/runtime` | Schedules, per-tenant secret lookup and the global settings shared by the dashboard and agent. |
| `packages/feeds` | CSV and API plan feeds, normalisation and sync for the catalog module. |
| `packages/content` | Article file format, safe Markdown rendering, text measures (readability, similarity, diff). |
| `packages/llm` | Claude client with structured output and web search, cost meter and budget stop, scripted stand-in for tests. |
| `agent` | The article agent: topics, research, writer, quality checks, pull requests, revise, notify, scheduled publish. |
| `tracker` | AI visibility tracker: assistant providers, answer analysis, Search Console. |
| `packages/tenant-ops` | Add, edit, pause, remove, export and roll back tenants. Used by the CLI now and the dashboard later. |
| `cli` | The `pnpm avp` command (see below). |
| `scripts` | Idempotent Cloudflare Pages project and custom-domain setup, used by the deploy workflow. |
| `docs` | Actions usage estimate and secrets handling. |
| `.github/workflows` | CI, and a manual site deploy workflow. |

## What every generated site includes

- Static HTML that reads fine without JavaScript
- JSON-LD: Organization, WebSite, Service, FAQPage, BlogPosting, BreadcrumbList and Person, validated by `audit:site`
- `llms.txt`, `robots.txt` (allows GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, Claude-User, PerplexityBot, Google-Extended and Applebot-Extended, with per-tenant overrides), `sitemap.xml` with hreflang, RSS feed
- Canonical URLs, Open Graph and Twitter metadata, one `<h1>` per page, no skipped heading levels
- English and Arabic out of the box: the default language lives at `/`, others under `/<lang>/`, with hreflang, `x-default` and RTL for Arabic
- Plausible or GA4 analytics, plus AI-assistant referral tracking (reported to Plausible as an "AI Referral" event)
- Staging builds (`SITE_ENV=staging`) block crawlers with `robots.txt` and `noindex`

Pages with nothing to show are not generated: no services means no Services page, and legal pages only exist when the owner supplies the text.

## Tenant config reference

`tenants/<id>/tenant.json`. The schema in `packages/tenant-schema/src/schema.ts` is the source of truth. `pnpm tenant:validate` reports errors (blocking) and warnings (launch-readiness advice for tenants with `status: "active"`).

Translated text is an object keyed by language code: `{ "en": "...", "ar": "..." }`.

| Field | Purpose |
|-------|---------|
| `schemaVersion` | Always `1`. |
| `id` | Folder name. Lowercase letters, numbers, hyphens. A leading `_` marks a template that is never deployed. |
| `status` | `active` or `paused`. Paused tenants are skipped by deploys and scheduled runs. |
| `identity` | `name`, `domain` (hostname only), `tagline`, `logo`, `brand.colors` (`primary`, `accent`, `background`, `text`), `brand.fonts`, `showPlatformBrand` (default `false`, white-label). |
| `languages` | `default` and `supported`. Every translation must use a supported language. |
| `profile` | `description`, `audience`, `geography`, `differentiators`, `offerings` (each with `id`, `name`, `summary`, optional `pricing`), `pricingApproach`. |
| `personas`, `pillars`, `questionTypes`, `competitors`, `keywords` | Inputs for the article agent. |
| `voice` | `tone`, `dos`, `donts`, `bannedClaims`. Banned phrases found in the tenant's own copy are a validation error. |
| `author` | Byline policy (`person`, `organization` or `team`), `name`, `bio`, optional `url`. |
| `site` | `pages` toggles (home, services, pricing, about, faq, contact, blog, legal) and optional `modules` (case studies, locations, catalog, comparisons). |
| `faq` | `question` and `answer` pairs. Active tenants should have 15 to 25, each answer 40 to 60 words. |
| `legal` | Markdown for `privacy` and `terms`, written or approved by the owner. |
| `integrations` | `leadForm` (`type` and `destination`), `analytics` (`plausible`, `ga4` or `none`), `feeds`. Holds destinations and public IDs only. |
| `agent` | `articlesPerDay`, `publishMode` (`approval` or `auto`), `paused`, `monthlyBudgetUsd`, `articleWords`, `articleLanguages`, `autoApproveMaxRisk`. |
| `crawlers` | `allowAI` and per-crawler `overrides`. |
| `trackerPrompts` | Prompts the weekly tracker will run. |
| `compliance` | `neverClaim` phrases and notes. |

**Secrets never go in tenant config.** API keys live in GitHub repository secrets and the host's secret store.

## Add a business

1. `pnpm avp tenant add <id> --name "..." --domain ...` creates a paused tenant from the template.
2. Fill in `tenants/<id>/tenant.json` (or use `tenant edit --set`).
3. `pnpm avp validate <id>`, then `pnpm avp site build <id>` and `pnpm avp audit <id>`.
4. `pnpm avp tenant resume <id>` when the warnings are cleared. Commit and push to deploy.

In Phase 3 the dashboard does the same through a form and commits the result.

## Environments and deploys

- **Production**: a push to `main` deploys every affected active tenant to Cloudflare Pages, one project per tenant (`<prefix>-<tenant>`), and attaches the tenant's custom domain.
- **Staging**: a push to the `staging` branch deploys the same build with `SITE_ENV=staging` (crawlers blocked) to the `staging` branch of the same Pages project. Use it to test template changes before they reach live sites.
- Only tenants affected by a push are rebuilt. A change to shared code (the site template or packages) rebuilds all active tenants.
- After a production deploy, IndexNow is pinged for the articles that changed.
- **Nothing deploys until you turn it on**: set the repository variable `DEPLOY_ENABLED` to `true` and add the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. Optionally set the variable `CLOUDFLARE_PROJECT_PREFIX` (default `avp`). Merging before this is safe.
- CI (`.github/workflows/ci.yml`) typechecks, tests, validates every tenant, then builds and audits only the tenants a change touches.
- Limits and cost at 3, 10 and 50 tenants: [docs/ACTIONS-USAGE.md](docs/ACTIONS-USAGE.md). Secrets: [docs/SECRETS.md](docs/SECRETS.md).

## Design rules

- The business is data, not code.
- Cloud first: nothing here depends on a personal computer.
- Never publish unverified claims, invented statistics or fake testimonials, and never guarantee results.

## Roadmap

All eight phases are built: foundation, cloud runtime and tenant system, dashboard, seed tenants, article agent with review queue, agent at scale, tracker and reports, commercial layer. What remains is in [docs/SETUP.md](docs/SETUP.md) (what you provide) and [docs/STATUS.md](docs/STATUS.md) (what is untested and not built).
