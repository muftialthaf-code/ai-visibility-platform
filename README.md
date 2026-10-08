# AI Search Visibility Platform

A multi-tenant platform that makes any business easy for AI assistants and search engines to find, understand and recommend (AEO and GEO). Each business is a **tenant**: one config bundle in `/tenants/<id>`, from which the platform builds a complete, crawlable website. Nothing about any specific business is hardcoded in platform code.

**Status: Phase 2 (cloud runtime and tenant system).** Tenant schema, shared SEO package, one generic English and Arabic site template, the full tenant CLI, IndexNow, and automatic staging and production deploys. The dashboard, article agent and tracker come in later phases (see [Roadmap](#roadmap)).

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
pnpm avp indexnow ping <id> --urls <a,b> [--dry-run]
```

Add `--commit` to any command that changes tenants to commit the change in git. Every change is validated first, and nothing is written if validation fails.

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
| `status` | `active` or `paused`. Paused tenants will be skipped by scheduled runs (enforced by the scheduler in Phase 2). |
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
| `agent` | `articlesPerDay`, `publishMode` (`approval` or `auto`), `paused`, `monthlyBudgetUsd`, `articleWords`. |
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

1. Foundation (done)
2. Cloud runtime and tenant system (done): automatic deploys, per-tenant Pages projects, IndexNow, full tenant CLI
3. Dashboard v1: login, overview, Businesses, run history
4. Seed tenants launched as ordinary tenants
5. Article agent with the Review Queue (approval-first)
6. Agent at scale: matrix schedule, alerts, budget caps, per-tenant cost
7. AEO/GEO tracker and reports with PDF export
8. Commercialization: client roles, white-labeling, billing hooks
