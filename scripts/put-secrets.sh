#!/usr/bin/env bash
#
# Bulk-upload Cloudflare Worker secrets from .env — no copy-paste.
#
# Reads values from .env and pipes each to `wrangler secret put NAME` via stdin,
# so secret values never appear as command-line args or in shell history.
#
# Usage:
#   ./scripts/put-secrets.sh              # upload to the default (production) env
#   ENV_FILE=.env.staging ./scripts/put-secrets.sh
#   WRANGLER_ENV=staging ./scripts/put-secrets.sh   # -> wrangler secret put --env staging
#
# Only the names in SECRETS below are uploaded. Non-secret config lives in
# [vars] in wrangler.jsonc (EMAIL_FROM, HERMES_WEBHOOK_URL) and the PUBLIC_*
# build-time vars — those are intentionally NOT secrets and are skipped.

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"

# The exact secrets this Worker needs.
SECRETS=(
  DATABASE_URL
  DATABASE_AUTH_TOKEN
  FEEDBACK_DATABASE_URL
  FEEDBACK_DATABASE_AUTH_TOKEN
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  GITHUB_CLIENT_ID
  GITHUB_CLIENT_SECRET
  HERMES_WEBHOOK_SECRET
  HERMES_APP_TOKEN
)

# Vercel/Turbo inject these at build time. When pulling with `vercel env pull`
# they land in the .env file — but they are platform metadata, NOT app secrets,
# and must never be uploaded to the Worker. They're already excluded by virtue
# of not being in SECRETS above; this deny-list is a belt-and-suspenders guard
# so a stray addition to SECRETS can't silently leak one.
DENY=(
  TURBO_CACHE TURBO_DOWNLOAD_LOCAL_ENABLED TURBO_REMOTE_ONLY TURBO_RUN_SUMMARY
  VERCEL VERCEL_ENV VERCEL_TARGET_ENV VERCEL_URL VERCEL_OIDC_TOKEN
  VERCEL_GIT_COMMIT_AUTHOR_LOGIN VERCEL_GIT_COMMIT_AUTHOR_NAME
  VERCEL_GIT_COMMIT_MESSAGE VERCEL_GIT_COMMIT_REF VERCEL_GIT_COMMIT_SHA
  VERCEL_GIT_PREVIOUS_SHA VERCEL_GIT_PROVIDER VERCEL_GIT_PULL_REQUEST_ID
  VERCEL_GIT_REPO_ID VERCEL_GIT_REPO_OWNER VERCEL_GIT_REPO_SLUG
)

is_denied() {
  local k="$1"
  for d in "${DENY[@]}"; do [[ "$k" == "$d" ]] && return 0; done
  return 1
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ $ENV_FILE not found (set ENV_FILE=path to override)" >&2
  exit 1
fi

# Pass --env <name> to wrangler only if WRANGLER_ENV is set.
env_args=()
[[ -n "${WRANGLER_ENV:-}" ]] && env_args=(--env "$WRANGLER_ENV")

# Read one key's value from the env file without echoing it.
# Handles: optional `export `, `KEY=value`, and surrounding single/double quotes.
read_value() {
  local key="$1"
  # Last matching assignment wins (mirrors dotenv). Strip key=, then quotes.
  local line
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" | tail -n1 || true)"
  [[ -z "$line" ]] && return 1
  local val="${line#*=}"
  # Trim surrounding matching quotes.
  if [[ "$val" == \"*\" ]]; then val="${val%\"}"; val="${val#\"}";
  elif [[ "$val" == \'*\' ]]; then val="${val%\'}"; val="${val#\'}"; fi
  printf '%s' "$val"
}

uploaded=0 skipped=0 denied=0
for key in "${SECRETS[@]}"; do
  if is_denied "$key"; then
    echo "  ⛔ refusing $key (platform metadata — remove from SECRETS)"
    denied=$((denied + 1))
    continue
  fi
  if value="$(read_value "$key")" && [[ -n "$value" ]]; then
    echo "→ putting $key"
    printf '%s' "$value" | pnpm exec wrangler secret put "$key" "${env_args[@]}" >/dev/null
    uploaded=$((uploaded + 1))
  else
    echo "  skip $key (not set in $ENV_FILE)"
    skipped=$((skipped + 1))
  fi
done

echo "✅ done — $uploaded uploaded, $skipped skipped, $denied denied"
