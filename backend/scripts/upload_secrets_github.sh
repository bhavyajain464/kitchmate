#!/usr/bin/env bash
# Upload backend secrets from backend/.env into a GitHub Environment
# (staging | production). Cloud Run deploys read these via the deploy workflows.
#
# Usage:
#   ./scripts/upload_secrets_github.sh staging
#   ./scripts/upload_secrets_github.sh production
#   KAFKA_CA_PEM_FILE=~/Downloads/ca.pem ./scripts/upload_secrets_github.sh staging
#
# Requires: gh auth with repo + environment secrets scopes.
set -euo pipefail

ENV_NAME="${1:-}"
if [[ "$ENV_NAME" != "staging" && "$ENV_NAME" != "production" ]]; then
  echo "Usage: $0 staging|production" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/backend/.env}"
REPO="${GITHUB_REPO:-bhavyajain464/rasoibuddy}"
CA_FILE="${KAFKA_CA_PEM_FILE:-}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required" >&2
  exit 1
fi

get_env() {
  local key="$1"
  local line
  line=$(grep -E "^${key}=" "$ENV_FILE" | tail -1 || true)
  if [[ -z "$line" ]]; then
    echo ""
    return
  fi
  echo "${line#*=}"
}

set_secret() {
  local name="$1"
  local value="$2"
  if [[ -z "${value}" ]]; then
    echo "skip $name (empty)"
    return 1
  fi
  printf '%s' "$value" | gh secret set "$name" --repo "$REPO" --env "$ENV_NAME"
  echo "set $name"
  return 0
}

# Ensure environment exists (idempotent).
gh api --method PUT "repos/${REPO}/environments/${ENV_NAME}" >/dev/null

echo "Uploading secrets to GitHub Environment: ${ENV_NAME} (repo ${REPO})"

failed=0
set_secret DATABASE_URL "$(get_env DATABASE_URL)" || failed=1
set_secret GEMINI_API_KEY "$(get_env GEMINI_API_KEY)" || failed=1
set_secret GOOGLE_VISION_API_KEY "$(get_env GOOGLE_VISION_API_KEY)" || failed=1
set_secret GROQ_API_KEY "$(get_env GROQ_API_KEY)" || failed=1
set_secret SESSION_TOKEN_SECRET "$(get_env SESSION_TOKEN_SECRET)" || failed=1
set_secret REDIS_URL "$(get_env REDIS_URL)" || failed=1
set_secret KAFKA_PASSWORD "$(get_env KAFKA_PASSWORD)" || failed=1
set_secret SMTP_PASS "$(get_env SMTP_PASS)" || failed=1

# Optional but used by admin routes when present.
admin_key="$(get_env ADMIN_API_KEY)"
if [[ -n "$admin_key" ]]; then
  set_secret ADMIN_API_KEY "$admin_key" || true
fi

if [[ "$ENV_NAME" == "staging" ]]; then
  set_secret RAZORPAY_KEY_ID_STAGING "$(get_env RAZORPAY_KEY_ID_STAGING)" || failed=1
  set_secret RAZORPAY_KEY_SECRET_STAGING "$(get_env RAZORPAY_KEY_SECRET_STAGING)" || failed=1
  set_secret RAZORPAY_WEBHOOK_SECRET_STAGING "$(get_env RAZORPAY_WEBHOOK_SECRET_STAGING)" || failed=1
else
  set_secret RAZORPAY_KEY_ID_PRODUCTION "$(get_env RAZORPAY_KEY_ID_PRODUCTION)" || failed=1
  set_secret RAZORPAY_KEY_SECRET_PRODUCTION "$(get_env RAZORPAY_KEY_SECRET_PRODUCTION)" || failed=1
  set_secret RAZORPAY_WEBHOOK_SECRET_PRODUCTION "$(get_env RAZORPAY_WEBHOOK_SECRET_PRODUCTION)" || failed=1
fi

# Kafka CA: prefer explicit PEM env, else KAFKA_CA_PEM_FILE / KAFKA_CA_FILE path.
ca_pem="$(get_env KAFKA_CA_PEM)"
if [[ -z "$ca_pem" ]]; then
  if [[ -z "$CA_FILE" ]]; then
    CA_FILE="$(get_env KAFKA_CA_FILE)"
  fi
  if [[ -n "$CA_FILE" && -f "$CA_FILE" ]]; then
    ca_pem="$(cat "$CA_FILE")"
  fi
fi
set_secret KAFKA_CA_PEM "$ca_pem" || failed=1

if [[ "$failed" -ne 0 ]]; then
  echo "One or more required secrets were missing — fix $ENV_FILE (and CA PEM) then re-run." >&2
  exit 1
fi

echo "Done. Re-run Deploy backend to Cloud Run (${ENV_NAME}) from Actions."
