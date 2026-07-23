#!/usr/bin/env bash
#
# Bulk-upload Cloudflare Worker secrets from .env — no copy-paste.
#
# Reads values from .env and pipes each to `wrangler secret put NAME` via stdin,
# so secret values never appear as command-line args or in shell history.
#
# Usage:
#   ./scripts/put-secrets.sh              # uses .env.production (default), else .env
#   ENV_FILE=.env ./scripts/put-secrets.sh          # force local/dev values
#   ENV_FILE=.env.staging ./scripts/put-secrets.sh
#   WRANGLER_ENV=staging ./scripts/put-secrets.sh   # -> wrangler secret put --env staging
#
# `wrangler secret put` with no --env targets the LIVE Worker, so the default is
# .env.production (the production values) — defaulting to .env once pushed dev
# secrets (e.g. sk_test) to prod. The chosen file is printed before uploading.
#
# Exclude-based: uploads EVERY key found in the env file EXCEPT the ones in DENY
# below. This way a newly added secret is pushed automatically — you don't have
# to remember to allowlist it. The trade-off is the opposite failure mode: a var
# that should NOT be a secret must be added to DENY, or it gets uploaded. To
# make that safe, anything uploaded that isn't in the KNOWN list prints a
# warning so a surprise var can't slip in silently.

set -euo pipefail

# Wrangler 4.x AUTO-LOADS .env and treats CF_API_TOKEN / CLOUDFLARE_API_TOKEN as
# its OWN auth credential. Since we store CF_API_TOKEN as an APP secret in .env,
# wrangler would try to authenticate the CLI with it (it only has SSL:Edit scope)
# and fail — or shadow your `wrangler login` session. Strip both from wrangler's
# environment so the CLI uses your OAuth login; this does NOT affect the VALUES we
# read from the env file and upload (that's read_value below, not the env).
wrangler() { env -u CF_API_TOKEN -u CLOUDFLARE_API_TOKEN pnpm exec wrangler "$@"; }

# Default to .env.production (this uploads to the live Worker); fall back to .env
# only if no production file exists. Override explicitly with ENV_FILE=...
if [[ -n "${ENV_FILE:-}" ]]; then
  : # caller specified it explicitly
elif [[ -f .env.production ]]; then
  ENV_FILE=.env.production
else
  ENV_FILE=.env
fi

# Names that must NEVER be pushed as Worker secrets:
#   - Vercel/Turbo build metadata (land in .env via `vercel env pull`).
#   - Non-secret runtime config that belongs in [vars] in wrangler.jsonc.
#   - Stale config from before the Cloudflare Email migration (MAILGUN_*).
#   - API-side keys the UI Worker does not use (ADMIN_API_KEY).
DENY=(
  # Vercel / Turbo / Nx build-tool metadata
  TURBO_CACHE TURBO_DOWNLOAD_LOCAL_ENABLED TURBO_REMOTE_ONLY TURBO_RUN_SUMMARY
  NX_DAEMON
  VERCEL VERCEL_ENV VERCEL_TARGET_ENV VERCEL_URL VERCEL_OIDC_TOKEN
  VERCEL_GIT_COMMIT_AUTHOR_LOGIN VERCEL_GIT_COMMIT_AUTHOR_NAME
  VERCEL_GIT_COMMIT_MESSAGE VERCEL_GIT_COMMIT_REF VERCEL_GIT_COMMIT_SHA
  VERCEL_GIT_PREVIOUS_SHA VERCEL_GIT_PROVIDER VERCEL_GIT_PULL_REQUEST_ID
  VERCEL_GIT_REPO_ID VERCEL_GIT_REPO_OWNER VERCEL_GIT_REPO_SLUG
  # Non-secret runtime config — lives in [vars] in wrangler.jsonc, not secrets.
  HERMES_WEBHOOK_URL
  # Stale: replaced by Cloudflare Email Sending; not used by the Worker.
  MAILGUN_API_KEY MAILGUN_DOMAIN MAILGUN_FROM_EMAIL
  # API-side admin key; the UI Worker does not use it.
  ADMIN_API_KEY
  # PUBLIC_* are plaintext runtime config in wrangler.jsonc [vars] (read via
  # $env/dynamic/public). A binding name can't be BOTH a var and a secret, so
  # uploading them here fails with "Binding name already in use". Keep them out.
  PUBLIC_DOMAIN PUBLIC_API_URL PUBLIC_STRIPE_MONTHLY_LINK PUBLIC_STRIPE_YEARLY_LINK
)

# Vars we expect and have deliberately classified (either uploaded or denied).
# Anything NOT here that gets uploaded triggers a warning — so a genuinely new
# secret is pushed automatically AND surfaced for you to confirm/deny.
KNOWN=(
  DATABASE_URL DATABASE_AUTH_TOKEN
  FEEDBACK_DATABASE_URL FEEDBACK_DATABASE_AUTH_TOKEN
  STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET
  GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
  GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET
  HERMES_WEBHOOK_SECRET HERMES_APP_TOKEN
  # Cloudflare for SaaS custom-hostname provisioning (src/lib/server/cloudflare.ts).
  CF_API_TOKEN CF_ZONE_ID
)

in_list() {
  local k="$1"; shift
  local x
  for x in "$@"; do [[ "$k" == "$x" ]] && return 0; done
  return 1
}
is_denied() { in_list "$1" "${DENY[@]}"; }
is_known()  { in_list "$1" "${KNOWN[@]}"; }

# Collect every KEY defined in the env file (dedup, last-wins handled by read_value).
collect_keys() {
  grep -oE "^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=" "$ENV_FILE" \
    | sed -E 's/^[[:space:]]*(export[[:space:]]+)?//; s/=$//' \
    | sort -u
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ $ENV_FILE not found (set ENV_FILE=path to override)" >&2
  exit 1
fi

# Preflight: wrangler must be resolvable, else `pnpm exec wrangler` fails mid-run
# with an opaque exit code after some secrets are already uploaded.
if ! wrangler --version >/dev/null 2>&1; then
  echo "❌ wrangler not found. Run \`pnpm install\` first (it's a devDependency)." >&2
  exit 1
fi

# Pass --env <name> to wrangler only if WRANGLER_ENV is set.
env_args=()
[[ -n "${WRANGLER_ENV:-}" ]] && env_args=(--env "$WRANGLER_ENV")

echo "📤 Uploading secrets from '$ENV_FILE' → Worker env '${WRANGLER_ENV:-<default/production>}'"

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

uploaded=0 skipped=0 denied=0 unknown=0 failed=0
while IFS= read -r key; do
  [[ -z "$key" ]] && continue
  if is_denied "$key"; then
    echo "  ⛔ deny $key (excluded — not a Worker secret)"
    denied=$((denied + 1))
    continue
  fi
  if value="$(read_value "$key")" && [[ -n "$value" ]]; then
    if is_known "$key"; then
      echo "→ putting $key"
    else
      # New/unclassified var: upload it (exclude-based default) but flag it so a
      # surprise never slips in unnoticed. Add it to KNOWN, or to DENY if it
      # should not be a secret.
      echo "⚠️  putting $key (NOT in KNOWN — verify it belongs as a secret; else add to DENY)"
      unknown=$((unknown + 1))
    fi
    # Suppress wrangler's noisy success chatter on stdout, but let stderr through
    # so a real failure (auth, wrong account, invalid value) is visible. Don't let
    # one failed put abort the whole run (set -e): report it and keep going.
    if printf '%s' "$value" | wrangler secret put "$key" "${env_args[@]}" >/dev/null; then
      uploaded=$((uploaded + 1))
    else
      echo "  ❌ failed to put $key (see wrangler error above)" >&2
      failed=$((failed + 1))
      continue
    fi
  else
    echo "  skip $key (empty in $ENV_FILE)"
    skipped=$((skipped + 1))
  fi
done < <(collect_keys)

echo "✅ done — $uploaded uploaded, $skipped skipped, $denied denied, $unknown unclassified, $failed failed"
if [[ "$unknown" -gt 0 ]]; then
  echo "⚠️  $unknown var(s) were uploaded without being classified. Review the ⚠️ lines above."
fi
if [[ "$failed" -gt 0 ]]; then
  echo "❌ $failed var(s) failed to upload. Review the ❌ lines above." >&2
  exit 1
fi
