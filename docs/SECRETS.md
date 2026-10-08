# Secrets

Secrets never go in the repository, in tenant config, or in the browser.

| Where | What lives there |
|-------|------------------|
| GitHub repository secrets (Settings, Secrets and variables, Actions) | Everything the workflows need: Cloudflare token, model and search API keys, database URL, email key |
| Hosting provider's secret store (the dashboard host) | The dashboard's own runtime secrets: session secret, GitHub token, database URL, email key |
| Tenant config (`tenant.json`) | Only public identifiers and the *names* of secrets, for example `integrations.feeds[].secretName` |

## Per-tenant keys and isolation

Every key can be set globally and overridden per tenant. The platform looks for the tenant's variable first, then the global one:

```
ANTHROPIC_API_KEY__ACME_DENTAL     used for tenant "acme-dental"
ANTHROPIC_API_KEY                  global fallback
```

The tenant id is upper-cased with hyphens turned into underscores. A tenant that brings its own key is billed on its own account. Usage is recorded per tenant either way, so cost can be reported or invoiced.

Workflows pass only the secrets a job needs. The agent job for one tenant does not receive another tenant's override keys, because the workflow maps just that tenant's variables into the job environment.

## The list

See [SETUP.md](./SETUP.md) for the complete list of secrets and variables, where to create each one, and which phase needs it.
