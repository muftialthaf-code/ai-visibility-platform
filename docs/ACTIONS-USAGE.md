# GitHub Actions usage estimate

Everything runs in GitHub Actions, so minutes are the main scaling limit. This is an **estimate from assumptions**, not a measurement. Phase 6 records the real duration of every run in the dashboard, so replace the assumptions below with measured numbers after the first two weeks of live runs.

## Assumptions (Linux runners, 1x multiplier)

GitHub bills each job rounded up to a whole minute.

| Workload | Minutes per run | Runs per tenant per month |
|----------|-----------------|---------------------------|
| Daily article agent (research, write, gates, open PR) | 8 | 30 (1 article a day) |
| Planning job that builds the tenant matrix | 1 | 30 |
| CI on the agent's pull request (one tenant built) | 1.5 | 30 |
| Deploy after an article merges (one tenant) plus the plan job | 3 | 30 |
| Weekly AEO/GEO tracker (depends on prompt count) | 5 | 4.3 |

That is about **433 minutes per tenant per month** at one article a day. The agent run dominates, and most of its time is waiting on model and search APIs.

CI cost does not grow with tenant count: CI builds only the tenants a change touches. A change to shared code (site template, packages) rebuilds every active tenant, which is rare.

## Totals

| Tenants | Minutes per month | Notes |
|---------|-------------------|-------|
| 3 | about 1,300 | Fits the Pro or Team included minutes. Over the Free allowance. |
| 10 | about 4,300 | Needs a paid plan, with a small overage. |
| 50 | about 21,500 | Needs Enterprise-level minutes, a different runner, or fewer runs. |

## Limits as I understand them (verify current figures before relying on them)

Private repositories, as of my knowledge: Free 2,000 included minutes a month, Pro and Team 3,000, Enterprise Cloud 50,000. Linux overage was $0.008 a minute. Concurrent job limits were 20 (Free), 40 (Pro), 60 (Team). A single job can run up to 6 hours. Scheduled workflows can start several minutes late, and the schedule may be skipped under heavy GitHub load.

## When to change something

- **About 4 tenants**: the Free allowance runs out. Move to a paid plan.
- **About 7 tenants**: Pro or Team included minutes run out. Overage is still cheap, roughly $15 a month at 10 tenants.
- **About 25 tenants and above (about 11,000 minutes)**: overage passes roughly $65 a month and the matrix starts to queue behind the concurrency limit. Options, in the order I would try them:
  1. Run the agent every second day for low-priority tenants (halves the agent cost).
  2. Use a self-hosted or larger runner. The workflows use `runs-on`, so switching is a one-line change.
  3. Move the agent loop to a container host that runs jobs from a queue, keeping Actions for CI and deploys.
- **The agent matrix**: `max-parallel` is capped so a 50-tenant run does not exceed the concurrency limit. Tenants beyond the cap wait, so the last tenant can finish well after the scheduled time.

## Cost outside Actions

Model and search API spend is separate and usually larger than runner cost. Each tenant has a `monthlyBudgetUsd` cap that stops its agent when reached, and spend is tracked per tenant in the dashboard.
