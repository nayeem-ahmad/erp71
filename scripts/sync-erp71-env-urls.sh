#!/usr/bin/env bash
# Ensure production env files use app.erp71.com / api.erp71.com after the domain rename.
# Idempotent — safe to run on every deploy.
#
# Only rewrites keys that are already present, so it never invents settings.
# NEXT_PUBLIC_MARKETING_URL is deliberately absent: it is the switch that turns
# two-domain routing on, and it stays whatever the operator set by hand once
# erp71.com resolves to this VPS (see docs/ops/deployment-runbook.md → Domains).
#
# NEXT_PUBLIC_API_BASE / NEXT_PUBLIC_API_URL are where the *browser* sends API
# calls, and they name the app's own origin: Caddy routes app.erp71.com/api/v1/*
# straight to the backend, and calling the page's own origin spares every call
# a CORS preflight — one round trip, about 0.25 s from Bangladesh — and every
# page load a second TLS connection (docs/ops/deployment-runbook.md → API on the
# app domain). Everything else keeps api.erp71.com: BACKEND_PUBLIC_URL builds
# the payment gateways' callback URLs, and the mobile app and API-key clients
# are configured with it. Because this rewrites both keys on every deploy,
# rolling back to api.erp71.com means changing the two lines below, not
# editing .env.production.
set -euo pipefail

ENV_FILE="${1:-.env.production}"

if [ ! -f "$ENV_FILE" ]; then
  echo "WARN: $ENV_FILE not found — skipping URL sync." >&2
  exit 0
fi

tmp="$(mktemp)"
sed \
  -e 's|^FRONTEND_URL=.*|FRONTEND_URL=https://app.erp71.com|' \
  -e 's|^BACKEND_PUBLIC_URL=.*|BACKEND_PUBLIC_URL=https://api.erp71.com|' \
  -e 's|^NEXT_PUBLIC_API_BASE=.*|NEXT_PUBLIC_API_BASE=https://app.erp71.com|' \
  -e 's|^NEXT_PUBLIC_API_URL=.*|NEXT_PUBLIC_API_URL=https://app.erp71.com|' \
  -e 's|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=https://app.erp71.com|' \
  -e 's|https://app\.nayeemahmad\.com|https://app.erp71.com|g' \
  -e 's|https://api\.nayeemahmad\.com|https://api.erp71.com|g' \
  "$ENV_FILE" > "$tmp"
mv "$tmp" "$ENV_FILE"
echo "==> Synced erp71.com URLs in $ENV_FILE"