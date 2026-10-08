# Status: what is verified and what is not

All eight phases are built. This page separates what ran from what is only written. Read it before turning anything on.

## Verified here (automated, repeatable)
- Unit tests across all packages: schema and validation, SEO output, tenant operations, database, GitHub client, content/safe rendering, cost meter, agent checks, agent run loop (draft, auto-publish, revision, hold, dry run, budget, daily idempotency, stuck runs, 12 businesses at once with separate branches and costs), tracker, Search Console parsing, reports maths, invites and billing statement.
- Browser tests (Playwright against the production build and a fake GitHub): sign-in with 2FA, adding and launching a business **through the dashboard with no code change** (the acceptance test), the agent producing a draft, review, request changes, approve, the article landing on `main` and the site building and passing the audit, topic backlog, client onboarding by invite link, client login confined to its own report, phone layout.
- Sites build for the fixture tenants and pass the AEO/GEO audit (JSON-LD, hreflang, llms.txt, robots, one h1).

## Not verified (written, never run against the real service)
- **Real Anthropic API.** Tests use a scripted stand-in. The request shapes (structured output, web search tool, pause handling, usage accounting) follow the documentation but have not been run live. First real run: use "Practice run".
- **Real GitHub.** Tests use a model of the API. Not simulated: rate limits, branch protection, required checks, merge conflicts, permissions, and the "Allow Actions to create pull requests" setting.
- **GitHub Actions workflows.** YAML parses; none has run. CI results for the Phase 3 to 8 pushes were not checked (my GitHub tools only covered the other repository).
- **Cloudflare deploy scripts** never executed.
- **Postgres over the network.** Tests use PGlite. SSL to a hosted Postgres (certificate checking is relaxed) and connection pooler quirks are untested.
- **Perplexity, OpenAI and Google Search Console.** Tested with fake responses only. The default OpenAI model name is a guess.
- **Resend email.** Tested with a fake endpoint.
- **Dashboard hosting.** No deploy config; never run on a real host.
- **Cost figures.** Model prices and per-search cost are assumptions. Actions minutes in `ACTIONS-USAGE.md` are an estimate; the Costs page measures real run time once runs exist.

## Quality caveats
- No native speaker has reviewed Arabic output. The tests use clearly labelled filler text.
- The model checks reduce risk; they do not replace a person reading. Keep approval-first until you trust a business's output.
- "Mentioned" detection is text matching: a business with a common name can give false positives.
- The tracker measures what assistants answered that week; answers vary run to run.

## Not built
- Payment provider integration (Stripe etc.), invoices, price plans.
- Automatic emailing of reports to clients (they sign in to view).
- AI-referral traffic (from analytics) in reports.
- Server-generated PDFs.
- A deploy pipeline for the dashboard.
