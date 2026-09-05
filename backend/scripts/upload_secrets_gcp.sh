#!/usr/bin/env bash
# DEPRECATED: Cloud Run deploys now inject secrets from GitHub Environments
# (production / staging), not GCP Secret Manager. Prefer setting those in
# GitHub → Settings → Environments. Kept only for one-off GCP secret recovery.
# Upload backend secrets from backend/.env to GCP Secret Manager (never commit .env).
set -euo pipefail

PROJECT="${GCP_PROJECT:-kitchmate-495620}"
ENV_FILE="${1:-$(dirname "$0")/../.env}"
RUNTIME_SA="${RUNTIME_SA:-208103249970-compute@developer.gserviceaccount.com}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
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

upsert_secret() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "skip $name (empty)"
    return
  fi
  if gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --project "$PROJECT" --data-file=-
    echo "updated $name"
  else
    printf '%s' "$value" | gcloud secrets create "$name" --project "$PROJECT" --replication-policy=automatic --data-file=-
    echo "created $name"
  fi
  gcloud secrets add-iam-policy-binding "$name" --project "$PROJECT" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" --quiet >/dev/null
}

upsert_secret "database-url" "$(get_env DATABASE_URL)"
upsert_secret "gemini-api-key" "$(get_env GEMINI_API_KEY)"
upsert_secret "google-vision-api-key" "$(get_env GOOGLE_VISION_API_KEY)"
upsert_secret "groq-api-key" "$(get_env GROQ_API_KEY)"
upsert_secret "session-token-secret" "$(get_env SESSION_TOKEN_SECRET)"
upsert_secret "redis-url" "$(get_env REDIS_URL)"
upsert_secret "kafka-sasl-password" "$(get_env KAFKA_PASSWORD)"

upsert_secret "razorpay-key-id-staging" "$(get_env RAZORPAY_KEY_ID_STAGING)"
upsert_secret "razorpay-key-secret-staging" "$(get_env RAZORPAY_KEY_SECRET_STAGING)"
upsert_secret "razorpay-webhook-secret-staging" "$(get_env RAZORPAY_WEBHOOK_SECRET_STAGING)"
upsert_secret "razorpay-key-id-production" "$(get_env RAZORPAY_KEY_ID_PRODUCTION)"
upsert_secret "razorpay-key-secret-production" "$(get_env RAZORPAY_KEY_SECRET_PRODUCTION)"
upsert_secret "razorpay-webhook-secret-production" "$(get_env RAZORPAY_WEBHOOK_SECRET_PRODUCTION)"

smtp_pass="$(get_env SMTP_PASS)"
if [[ -n "$smtp_pass" ]]; then
  upsert_secret "smtp-pass" "$smtp_pass"
fi

admin_key="$(get_env ADMIN_API_KEY)"
if [[ -n "$admin_key" ]]; then
  upsert_secret "admin-api-key" "$admin_key"
fi

translate="$(get_env GOOGLE_TRANSLATE_KEY)"
if [[ -n "$translate" ]]; then
  upsert_secret "google-translate-key" "$translate"
fi

echo "Done. Kafka CA PEM: gcloud secrets versions add kafka-ca-pem --data-file=/path/to/ca.pem"
