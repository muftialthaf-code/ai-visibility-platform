# Decisions log

Decisions you made, then ones I made while working without confirmation. Change any of them; each says what it affects.

## Yours
1. New private repository, personal GitHub account.
2. Astro for sites, Cloudflare Pages for hosting.
3. English and Arabic.

## Mine (defaults, reversible)
| Area | Decision | Reason / effect |
|------|----------|-----------------|
| Config | A business is `tenants/<id>/tenant.json` plus articles and data, validated and committed on every change. GitHub is the source of truth | Rollback and audit for free; no code change to add a business |
| Database | Postgres holds users, audit log, runs, usage, topics, notifications, tracker results, onboarding. Tests use PGlite | Anything not config or content lives here |
| Review flow | The agent opens one pull request per article; review data is embedded in the PR body; merge = publish | Dashboard needs only GitHub; history is in git |
| Default mode | Approval first. Optional per-business auto-approve below a risk score | Safe by default |
| Quality gates | Deterministic checks (structure, length, meta, sources, numbers cited, banned claims, duplicates, originality, readability, schema, language) plus two model reviews (editorial, claim verification). Failing blockers trigger one automatic rewrite, then the draft is held for a person | Nothing unverified is published silently |
| Sources | A fact citing a page the search did not return is dropped. Undated sources are dated by access day and marked "(accessed)" | Prevents invented citations |
| Models | Author `claude-opus-5-5`, judge `claude-sonnet-5-5`, editable in Settings | Cost versus quality |
| Languages | One native article per configured language (not a translation); same slug | Costs a full article per language |
| Budgets | Per-business monthly cap stops the agent; warning at 80%; unknown models priced at the highest rate | Errs toward stopping |
| Scale | Matrix job per business, max 3 in parallel, one run per business at a time, scheduled runs idempotent per day, stuck runs recovered after 90 minutes | Safe to re-run |
| Secrets | Global key with per-business override by naming convention; never in config | See SECRETS.md |
| Tracker | Weekly. "Mentioned" = name or domain in the answer text; "cited" = a source URL on the domain. Errors are not counted as misses | Simple and explainable; not a ranking measure |
| Reports | Online report with trend chart and CSV; "PDF" is the browser's print-to-PDF | No server-side PDF renderer to host |
| Clients | Clients get a login limited to their own business's report. Onboarding is via single-use, expiring, hashed invite links; the owner turns answers into a paused business | A public form that writes to GitHub would be an abuse vector |
| Billing | Usage statement (CSV, JSON, signed webhook). No prices, no payment provider | Pricing is your decision |
| Article safety | Article Markdown is escaped and filtered (no raw HTML, scripts, images) | Agent output is untrusted |
| Dashboard hosting | Not chosen | Your call; see SETUP |
| Seed businesses | Loaded paused, with placeholders flagged and launch blocked while placeholder text remains | No fabricated facts |
