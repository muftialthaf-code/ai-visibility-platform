#!/usr/bin/env bash
# Attach a custom domain to a tenant's Pages project. Safe to re-run; "already exists" is not an error.
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. DNS must point at the project
# (automatic when the domain's DNS is on the same Cloudflare account).
# Usage: ensure-pages-domain.sh <project-name> <domain>
set -euo pipefail
project="${1:?project name required}"
domain="${2:?domain required}"

body=$(mktemp)
status=$(curl -sS -o "$body" -w '%{http_code}' -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${project}/domains" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"${domain}\"}")

if [ "$status" = "200" ]; then
  echo "Attached ${domain} to ${project}"
elif grep -qi "already" "$body"; then
  echo "${domain} is already attached to ${project}"
else
  echo "::warning::Could not attach ${domain} (HTTP ${status}). Add it in the Cloudflare dashboard. Response:"
  cat "$body"
fi
