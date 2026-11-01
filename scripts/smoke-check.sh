#!/usr/bin/env bash
# Post-deploy smoke checks for production and staging.
#
# Usage:
#   ./scripts/smoke-check.sh
#   API_BASE=https://api.erp71.com APP_BASE=https://app.erp71.com ./scripts/smoke-check.sh

set -euo pipefail

API_BASE="${API_BASE:-https://api.erp71.com}"
APP_BASE="${APP_BASE:-https://app.erp71.com}"

echo "Checking API health at ${API_BASE}/api/v1/health ..."
health_json="$(curl -fsS "${API_BASE}/api/v1/health")"
echo "$health_json" | grep -q '"status":"ok"' || {
  echo "API health check failed: $health_json"
  exit 1
}

echo "Checking frontend at ${APP_BASE} ..."
frontend_status="$(curl -fsSI "${APP_BASE}" | head -n 1)"
echo "$frontend_status" | grep -Eq '200|301|302' || {
  echo "Frontend check failed: $frontend_status"
  exit 1
}

echo "All smoke checks passed."