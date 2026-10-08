#!/usr/bin/env bash
# Create the Cloudflare Pages project for a tenant if it does not exist yet. Safe to re-run.
# Usage: ensure-pages-project.sh <project-name>
set -euo pipefail
project="${1:?project name required}"

if npx --yes wrangler@4 pages project list 2>/dev/null | grep -qw "$project"; then
  echo "Pages project $project already exists"
else
  echo "Creating Pages project $project"
  npx --yes wrangler@4 pages project create "$project" --production-branch=main
fi
