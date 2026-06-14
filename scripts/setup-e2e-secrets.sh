#!/usr/bin/env bash
#
# Sets the GitHub Actions secrets (and optional variables) required by the
# nightly read-only E2E workflow (.github/workflows/nightly-readonly-e2e.yml).
#
# Run this on a machine where the `gh` CLI is installed and authenticated
# (`gh auth login`). It never prints secret values and does not store them in
# shell history.
#
# Usage:
#   scripts/setup-e2e-secrets.sh                 # prompt for each value
#   scripts/setup-e2e-secrets.sh path/to/.env    # read values from an env file
#
# Env file format (KEY=VALUE per line; # comments and blank lines ignored):
#   E2E_TEST_EMAIL=smoke@example.com
#   E2E_TEST_PASSWORD=...
#   SMTP_HOST=smtp-relay.brevo.com
#   SMTP_PORT=587
#   SMTP_USER=...
#   SMTP_PASS=...
#   EMAIL_FROM=monitoring@yourdomain.com
#   # optional non-secret overrides (set as repo variables, not secrets):
#   PROD_BASE_URL=https://retail-saas-frontend.onrender.com
#   PROD_API_URL=https://retail-saas-backend.onrender.com
#   REPORT_EMAIL_TO=nayeem.ahmad@gmail.com

set -euo pipefail

REPO="${REPO:-nayeem-ahmad/retail-saas}"
ENV_FILE="${1:-}"

# Secrets (encrypted, never readable again) and variables (plain, optional).
REQUIRED_SECRETS=(E2E_TEST_EMAIL E2E_TEST_PASSWORD SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS EMAIL_FROM)
SECRET_PROMPTS=(
  "Read-only smoke-test login email"
  "Read-only smoke-test login password"
  "SMTP host (e.g. smtp-relay.brevo.com)"
  "SMTP port (e.g. 587)"
  "SMTP username / login"
  "SMTP password / API key"
  "From address (verified sender)"
)
# These secrets are sensitive enough to hide while typing.
HIDDEN_SECRETS=" E2E_TEST_PASSWORD SMTP_PASS "

OPTIONAL_VARS=(PROD_BASE_URL PROD_API_URL REPORT_EMAIL_TO)

# ---- preflight ------------------------------------------------------------

if ! command -v gh >/dev/null 2>&1; then
  echo "error: GitHub CLI (gh) is not installed. See https://cli.github.com/" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh is not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

echo "Target repository: $REPO"

# ---- load env file (optional) --------------------------------------------

# Reads KEY for the current secret/var out of $ENV_FILE, or empty if absent.
file_value() {
  local key="$1"
  [ -n "$ENV_FILE" ] || { printf ''; return; }
  # Match KEY=... , strip the KEY= prefix, take the last definition, trim CR.
  # `|| true` keeps a no-match (grep exit 1) from tripping pipefail + set -e.
  { grep -E "^[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null || true; } \
    | tail -n1 \
    | sed -E "s/^[[:space:]]*${key}=//" \
    | tr -d '\r'
}

if [ -n "$ENV_FILE" ]; then
  [ -f "$ENV_FILE" ] || { echo "error: env file not found: $ENV_FILE" >&2; exit 1; }
  echo "Reading values from: $ENV_FILE"
fi

# ---- set secrets ----------------------------------------------------------

for i in "${!REQUIRED_SECRETS[@]}"; do
  name="${REQUIRED_SECRETS[$i]}"
  prompt="${SECRET_PROMPTS[$i]}"
  value="$(file_value "$name")"

  if [ -z "$value" ]; then
    if [[ "$HIDDEN_SECRETS" == *" $name "* ]]; then
      read -r -s -p "  $prompt [$name]: " value; echo
    else
      read -r -p "  $prompt [$name]: " value
    fi
  fi

  if [ -z "$value" ]; then
    echo "  ! skipping $name (no value provided)"
    continue
  fi

  printf '%s' "$value" | gh secret set "$name" --repo "$REPO"
  echo "  ✓ set secret $name"
done

# ---- set optional variables ----------------------------------------------

for name in "${OPTIONAL_VARS[@]}"; do
  value="$(file_value "$name")"
  [ -n "$value" ] || continue   # only set if present in the env file
  gh variable set "$name" --repo "$REPO" --body "$value"
  echo "  ✓ set variable $name=$value"
done

# ---- summary --------------------------------------------------------------

echo
echo "Done. Current secrets:"
gh secret list --repo "$REPO"
echo
echo "Trigger a first run to confirm the email arrives:"
echo "  gh workflow run 'Nightly Read-Only E2E' --repo $REPO"
