# Staging / develop environment

The **develop** branch is the integration environment. **main** stays production.

| Layer | Production (`main`) | Staging (`develop`) |
| --- | --- | --- |
| Git branch | `main` | `develop` |
| Consumer web (Vercel) | Project **rasoibuddy** → [kitchmate-one.vercel.app](https://kitchmate-one.vercel.app) | **Preview** on `develop` → [kitchmate-git-develop-bhavyajain464-9089s-projects.vercel.app](https://kitchmate-git-develop-bhavyajain464-9089s-projects.vercel.app) |
| Partner web (Vercel) | *(not deployed from `main` yet)* | Project **rasoibuddy-partner** — **production branch `develop`** → [kitchmate-partner.vercel.app](https://kitchmate-partner.vercel.app) |
| API (Cloud Run) | `kitchenai-backend` | `kitchenai-backend-staging` |
| Razorpay | Live (`RAZORPAY_ENV=production`) | Test (`RAZORPAY_ENV=staging`) |
| DB | `kitch-mate` | `rasoibuddy-staging` (copy on same Oracle Postgres instance) |
| Redis / Kafka / LLM keys | Shared | Same secrets as production |

## Git workflow

```bash
git checkout develop
git pull origin develop
# feature work → PR into develop; when ready → PR develop → main
```

## Backend (Cloud Run staging)

- **Workflow:** `.github/workflows/deploy-backend-staging.yml` runs on push to `develop` when `backend/**` changes.
- **Service:** `kitchenai-backend-staging` in `asia-south1` (project `kitchmate-495620`).
- **API base URL:** `https://kitchenai-backend-staging-208103249970.asia-south1.run.app/api/v1`

Production deploys: `.github/workflows/deploy-backend.yml` on `main` only.

**Onboarding testing:** Set `ONBOARDING_ALWAYS_SHOW=true` on the staging Cloud Run service so `/onboarding/status` returns `onboarding_done: false` for every user (repeat testing). Leave unset for normal onboarding persistence.

## Consumer frontend (Vercel project: **rasoibuddy**)

One Vercel project, two environments via **branch-scoped env vars**:

| Variable | Production (`main`) | Preview (`develop` branch) |
| --- | --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | `https://kitchenai-backend-208103249970.asia-south1.run.app/api/v1` | `https://kitchenai-backend-staging-208103249970.asia-south1.run.app/api/v1` |
| `EXPO_PUBLIC_WEB_REDIRECT_URI` | `https://www.rasoibuddy.com` | `https://kitchmate-git-develop-bhavyajain464-9089s-projects.vercel.app` |
| `EXPO_PUBLIC_GOOGLE_*` | Same on both (add staging redirect URI in Google Cloud Console) | Same |

Pushes to **`develop`** create a **preview** deployment only (staging API/OAuth). **Production** web updates only when code lands on **`main`** (merge `develop` → `main`).

**Vercel (required):** In project **rasoibuddy** → Settings → Git → set **Production Branch** to `main`. Do not promote preview deployments to production manually from the dashboard.

**Google OAuth:** Add the develop preview origin to your Web client (see `GOOGLE_OAUTH_SETUP.md`):

- `https://kitchmate-git-develop-bhavyajain464-9089s-projects.vercel.app`

## Partner frontend (Vercel project: **rasoibuddy-partner**)

Separate Vercel project for `frontend/kitchenai-restaurant` (restaurant staff app).

| Setting | Value |
| --- | --- |
| Root directory | `frontend/kitchenai-restaurant` |
| Production branch | **`develop`** (deploys staging stack, not `main`) |
| Build | `vercel.json` → `npm run build:web:vercel` (Expo web export) |
| Install | `cd .. && npm install` (npm workspace for `@kitchenai/api-core`) |

**Production env vars** (Vercel → Settings → Environment Variables → Production):

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | `https://kitchenai-backend-staging-208103249970.asia-south1.run.app/api/v1` |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Same as consumer web client |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Same as consumer |
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | Same as consumer |
| `EXPO_PUBLIC_WEB_REDIRECT_URI` | Partner Vercel URL (e.g. `https://kitchmate-partner.vercel.app`) |

**Google OAuth:** Add the partner deployment origin to the Web client authorized JavaScript origins and redirect URIs (see `GOOGLE_OAUTH_SETUP.md`).

Local staging run:

```bash
cd frontend/kitchenai-restaurant
cp staging.env.example staging.env   # fill Google client IDs
npm run web:staging
```

## Local builds against staging API

Copy `staging.env.example` → `staging.env` (gitignored):

```bash
DOTENV_CONFIG_PATH=staging.env npm run web
```

## What stays shared (for now)

- Redis, Kafka, Groq/Gemini keys, Google OAuth clients (with extra redirect URI for develop preview)

**Staging database:** `rasoibuddy-staging` on the same Oracle Cloud Postgres host as production (`kitch-mate`). Cloud Run staging reads **all secrets from the GitHub Environment `staging`** (not GCP Secret Manager).

Upload or refresh them from `backend/.env` (plus Kafka CA PEM):

```bash
# one-time: ensure gh can call api.github.com
gh auth refresh -h github.com -s repo,workflow

cd backend
KAFKA_CA_PEM_FILE=~/Downloads/ca.pem ./scripts/upload_secrets_github.sh staging
# when ready for prod (use a production DATABASE_URL in .env first):
# KAFKA_CA_PEM_FILE=~/Downloads/ca.pem ./scripts/upload_secrets_github.sh production
```

Required Environment secrets: `DATABASE_URL`, `GEMINI_API_KEY`, `GOOGLE_VISION_API_KEY`, `GROQ_API_KEY`, `SESSION_TOKEN_SECRET`, `REDIS_URL`, `KAFKA_PASSWORD`, `KAFKA_CA_PEM`, Razorpay staging keys, `SMTP_PASS`.

To refresh staging data from production:

```bash
pg_dump "postgresql://kitch_admin:…@140.245.26.151:5432/kitch-mate?sslmode=disable" --no-owner --no-acl \
  | psql "postgresql://kitch_admin:…@140.245.26.151:5432/rasoibuddy-staging?sslmode=disable" -q
```

## Staging API test suite

HTTP contract tests live in `backend/tests/stagingapi/` (Go build tag `staging`). **Default target is local** `http://localhost:8080` (loads `backend/.env` for `DATABASE_URL` / `SESSION_TOKEN_SECRET` and mints a session for any existing user).

```bash
cd backend
# start API in another terminal: go run ./cmd/api
./test_staging_api.sh

# Cloud Run staging instead:
STAGING_BASE_URL=staging STAGING_AUTH_TOKEN='eyJ...' ./test_staging_api.sh
# or: STAGING_BASE_URL=https://kitchenai-backend-staging-208103249970.asia-south1.run.app ...
```

Optional coverage:

| Env | Effect |
| --- | --- |
| `ADMIN_API_KEY` | Admin route checks |
| `STAGING_INCLUDE_RESTAURANT=1` | Partner/restaurant kitchen-scoped routes (off by default) |
| `STAGING_RESTAURANT_KITCHEN_ID` | Restaurant kitchen when restaurant suite is enabled |
| `STAGING_INCLUDE_LLM=1` | LLM-backed meal/WhatsApp/bill-scan routes |
| `STAGING_INCLUDE_ADMIN_WRITE=1` | Mutating admin catalog/cache routes |
| `STAGING_INCLUDE_DEEP=1` | Multi-step journeys (bill→inventory, purchase, WhatsApp apply, onboarding, billing order, diet loop, commerce) — on by default for localhost |
| `STAGING_INCLUDE_SIDE_EFFECTS=1` | Diet email send-test + panel push send (off by default) |

Live bill-scan fixtures (used when LLM + deep are on): `backend/tests/stagingapi/testdata/swiggy_bill.pdf` and `bill.webp`.

Manual CI: GitHub Actions → **Staging API suite** (`workflow_dispatch`). Configure secrets `STAGING_AUTH_TOKEN` (or `STAGING_USER_ID` + `STAGING_DATABASE_URL` + `STAGING_SESSION_TOKEN_SECRET`), plus optional admin/restaurant kitchen secrets.