# AI Search Visibility Platform

A multi-tenant platform that makes any business easy for AI assistants and search engines to find, understand and recommend (AEO and GEO). Each business is a **tenant**: one config bundle in `/tenants/<id>`, from which the platform builds a complete, crawlable website. Nothing about any specific business is hardcoded in platform code.

**Status: Phase 1 (Foundation).** Tenant schema, shared SEO package, one generic English and Arabic site template, CI. The dashboard, article agent, tracker and tenant CLI operations come in later phases (see [Roadmap](#roadmap)).

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
| `cli` | `tenant:validate`, `tenant:list`, `audit:site` (more in Phase 2). |
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

1. Copy `tenants/_template` to `tenants/<new-id>` and set `"id"` to the folder name.
2. Fill in `tenant.json`. Keep `"status": "paused"` while you draft.
3. Run `pnpm tenant:validate <new-id>`, then `TENANT=<new-id> pnpm build:site` and `pnpm audit:site <new-id>`.
4. Set `"status": "active"` when the validation warnings are cleared.

In Phase 3 the dashboard does this through a form and commits the result. The CLI becomes `tenant add`, `edit`, `pause`, `resume` and `remove`.

## Environments and deploys

- **Production** deploys the built site to Cloudflare Pages, one project per tenant, with the tenant's custom domain.
- **Staging** is the same build with `SITE_ENV=staging`, deployed to the `staging` branch of the same project.
- The `Deploy site` workflow is manual for now and needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets. Optionally set the repository variable `CLOUDFLARE_PROJECT_PREFIX` (default `avp`); projects are named `<prefix>-<tenant>`.
- CI (`.github/workflows/ci.yml`) typechecks, tests, validates all tenants, builds every tenant site and runs the audit on each push and pull request.

## Design rules

- The business is data, not code.
- Cloud first: nothing here depends on a personal computer.
- Never publish unverified claims, invented statistics or fake testimonials, and never guarantee results.

## Roadmap

1. **Foundation** (this phase)
2. Cloud runtime and tenant system: scheduled workflows, per-tenant Pages projects, IndexNow, full tenant CLI
3. Dashboard v1: login, overview, Businesses, run history
4. Seed tenants launched as ordinary tenants
5. Article agent with the Review Queue (approval-first)
6. Agent at scale: matrix schedule, alerts, budget caps, per-tenant cost
7. AEO/GEO tracker and reports with PDF export
8. Commercialization: client roles, white-labeling, billing hooks
