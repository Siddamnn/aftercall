#!/usr/bin/env bash
# Deploys aftercall to Google Cloud: API on Cloud Run, web on Firebase Hosting. Safe to re-run.
#
#   PROJECT=my-project ./deploy.sh              deploy
#   PROJECT=my-project ./deploy.sh --dry-run    print the commands, change nothing
#
# Reads PROJECT, VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_APP_ID and TYPESAFE_API_KEY from
# the root .env (or .env.deploy, which wins, or the environment). Optional: REGION, BUCKET, JEV_MODEL, VITE_APP_HOST.
# Runbook: docs/google-cup/deploy.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# Exported, so the VITE_FIREBASE_* values reach the web build. Values already in the environment win.
load_env() {
  local file="$1" line name value
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'
'}"
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    name="${BASH_REMATCH[1]}" value="${BASH_REMATCH[2]}"
    [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^'(.*)'$ ]] && value="${BASH_REMATCH[1]}"
    [[ -n "${!name:-}" ]] || export "$name=$value"
  done < "$file"
}
load_env "$ROOT/.env.deploy"
load_env "$ROOT/.env"

DRY_RUN=false
case "${1:-}" in
  --dry-run) DRY_RUN=true ;;
  "") ;;
  *) echo "Usage: PROJECT=<id> ./deploy.sh [--dry-run]" >&2; exit 1 ;;
esac

PROJECT="${PROJECT:-}"
[[ -n "$PROJECT" ]] || { echo "Set PROJECT to your Google Cloud project id." >&2; exit 1; }
REGION="${REGION:-asia-south1}"
BUCKET="${BUCKET:-${PROJECT}-alteria-audio}"
JEV_MODEL="${JEV_MODEL:-jev-1.13.0}"
# Invite links and workspace addresses use this host; the Firebase Hosting domain unless you have your own.
APP_HOST="${VITE_APP_HOST:-${PROJECT}.web.app}"
# Scales to zero when idle (no cost); the cap bounds the bill if something loops. Cloud Tasks runs at most 10 calls at once.
MAX_INSTANCES="${MAX_INSTANCES:-5}"

SERVICE=alteria-api
QUEUE=alteria-calls
SECRET=typesafe-api-key
API_SA_NAME=alteria-api
TASKS_SA_NAME=alteria-tasks
API_SA="${API_SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
TASKS_SA="${TASKS_SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
REQUIRED_APIS=(
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com
  cloudtasks.googleapis.com storage.googleapis.com secretmanager.googleapis.com aiplatform.googleapis.com
  firebase.googleapis.com identitytoolkit.googleapis.com iam.googleapis.com
)
API_ROLES=(roles/datastore.user roles/cloudtasks.enqueuer roles/aiplatform.user)

say() { printf '\n==> %s\n' "$*"; }

# Runs a command, or only prints it with --dry-run.
run() {
  if $DRY_RUN; then printf '  + %s\n' "$*"; else "$@"; fi
}

# Same, discarding the output (IAM binding commands print the whole policy).
run_quiet() {
  if $DRY_RUN; then printf '  + %s\n' "$*"; else "$@" >/dev/null; fi
}

# True when the resource exists. Always false in a dry run, so the plan shows every create.
exists() {
  $DRY_RUN && return 1
  "$@" >/dev/null 2>&1
}

ensure_apis() {
  say "Enabling APIs"
  run gcloud services enable "${REQUIRED_APIS[@]}" --project "$PROJECT"
}

ensure_firestore() {
  say "Firestore (native mode, $REGION)"
  exists gcloud firestore databases describe --database='(default)' --project "$PROJECT" && return 0
  run gcloud firestore databases create --database='(default)' --location "$REGION" --type firestore-native --project "$PROJECT"
}

ensure_bucket() {
  say "Audio bucket gs://$BUCKET"
  exists gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" && return 0
  run gcloud storage buckets create "gs://$BUCKET" --location "$REGION" --uniform-bucket-level-access --public-access-prevention --project "$PROJECT"
}

# Cloud Tasks retries a failed call with backoff; the dispatch rate keeps Gemini and Jev under their limits.
ensure_queue() {
  say "Cloud Tasks queue $QUEUE"
  local settings=(--max-attempts 5 --min-backoff 10s --max-backoff 300s --max-doublings 4
                  --max-dispatches-per-second 5 --max-concurrent-dispatches 10)
  if exists gcloud tasks queues describe "$QUEUE" --location "$REGION" --project "$PROJECT"; then
    run gcloud tasks queues update "$QUEUE" --location "$REGION" --project "$PROJECT" "${settings[@]}"
  else
    run gcloud tasks queues create "$QUEUE" --location "$REGION" --project "$PROJECT" "${settings[@]}"
  fi
}

ensure_service_account() {
  local name="$1" display="$2"
  exists gcloud iam service-accounts describe "${name}@${PROJECT}.iam.gserviceaccount.com" --project "$PROJECT" && return 0
  run gcloud iam service-accounts create "$name" --display-name "$display" --project "$PROJECT"
}

ensure_service_accounts() {
  say "Service accounts"
  ensure_service_account "$API_SA_NAME" "aftercall API (Cloud Run runtime)"
  ensure_service_account "$TASKS_SA_NAME" "aftercall Cloud Tasks invoker"
}

grant_api_permissions() {
  say "Least-privilege roles for $API_SA"
  local role
  for role in "${API_ROLES[@]}"; do
    run_quiet gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$API_SA" --role "$role" --condition=None --quiet
  done
  run_quiet gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$API_SA" --role roles/storage.objectAdmin
  # The API creates tasks that carry an OIDC token for the invoker account, so it must be allowed to act as it.
  run_quiet gcloud iam service-accounts add-iam-policy-binding "$TASKS_SA" --member "serviceAccount:$API_SA" --role roles/iam.serviceAccountUser --project "$PROJECT"
  grant_tasks_agent_token_access
}

# Cloud Tasks itself mints the OIDC token, so its service agent must be allowed to act as the invoker account.
grant_tasks_agent_token_access() {
  local number agent
  if $DRY_RUN; then number=PROJECT_NUMBER; else number="$(gcloud projects describe "$PROJECT" --format 'value(projectNumber)')"; fi
  agent="service-${number}@gcp-sa-cloudtasks.iam.gserviceaccount.com"
  run_quiet gcloud iam service-accounts add-iam-policy-binding "$TASKS_SA" --member "serviceAccount:$agent" --role roles/iam.serviceAccountUser --project "$PROJECT"
}

has_secret_version() {
  [[ -n "$(gcloud secrets versions list "$SECRET" --project "$PROJECT" --limit 1 --format 'value(name)' 2>/dev/null)" ]]
}

add_secret_version() {
  if [[ -n "${TYPESAFE_API_KEY:-}" ]]; then
    printf '%s' "$TYPESAFE_API_KEY" | gcloud secrets versions add "$SECRET" --data-file=- --project "$PROJECT" >/dev/null
    return
  fi
  [[ -t 0 ]] || { echo "Secret $SECRET has no value. Add one: printf %s \"\$KEY\" | gcloud secrets versions add $SECRET --data-file=- --project $PROJECT" >&2; exit 1; }
  local key
  read -rsp "Paste the TypeSafe Jev API key (hidden): " key; echo
  [[ -n "$key" ]] || { echo "Empty key." >&2; exit 1; }
  printf '%s' "$key" | gcloud secrets versions add "$SECRET" --data-file=- --project "$PROJECT" >/dev/null
}

ensure_secret() {
  say "Secret $SECRET"
  exists gcloud secrets describe "$SECRET" --project "$PROJECT" \
    || run gcloud secrets create "$SECRET" --replication-policy automatic --project "$PROJECT"
  if $DRY_RUN; then echo "  + (store TYPESAFE_API_KEY from .env, or prompt, if the secret has no version)"
  elif ! has_secret_version; then add_secret_version; fi
  run_quiet gcloud secrets add-iam-policy-binding "$SECRET" --member "serviceAccount:$API_SA" --role roles/secretmanager.secretAccessor --project "$PROJECT"
}

service_url() {
  if $DRY_RUN; then echo "https://${SERVICE}-HASH.${REGION}.run.app"; return; fi
  gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format 'value(status.url)' 2>/dev/null || true
}

deploy_api() {
  say "Deploying $SERVICE to Cloud Run"
  local env="STORE_BACKEND=firestore,GCP_PROJECT=$PROJECT,GOOGLE_CLOUD_PROJECT=$PROJECT,GOOGLE_GENAI_USE_VERTEXAI=true,GCS_BUCKET=$BUCKET"
  env+=",CLOUD_TASKS_QUEUE=$QUEUE,CLOUD_TASKS_LOCATION=$REGION,TASK_INVOKER_EMAIL=$TASKS_SA"
  env+=",FIREBASE_PROJECT_ID=$PROJECT,JEV_MODEL=$JEV_MODEL,APP_HOST=$APP_HOST"
  # Browsers may call the API only from these pages; any other site gets 403 (api.py OriginGuard).
  local origins="https://${PROJECT}.web.app https://${PROJECT}.firebaseapp.com"
  [[ "$APP_HOST" == "${PROJECT}.web.app" ]] || origins+=" https://$APP_HOST"
  env+=",CORS_ORIGINS=$origins,API_DOCS=false"
  local url; url="$(service_url)"
  if [[ -n "$url" ]]; then env+=",TASK_SERVICE_URL=$url"; fi
  run gcloud run deploy "$SERVICE" --source "$ROOT/apps/backend" --region "$REGION" --project "$PROJECT" \
    --service-account "$API_SA" --allow-unauthenticated --timeout 900 --memory 1Gi --cpu 1 --concurrency 80 \
    --min-instances 0 --max-instances "$MAX_INSTANCES" --cpu-boost --set-env-vars "$env" \
    --set-secrets "TYPESAFE_API_KEY=${SECRET}:latest" --quiet
}

# Cloud Tasks needs the service's own URL, which only exists after the first deploy.
sync_task_url() {
  local url; url="$(service_url)"
  [[ -n "$url" ]] || { echo "Could not read the service URL." >&2; exit 1; }
  say "TASK_SERVICE_URL=$url"
  run gcloud run services update "$SERVICE" --region "$REGION" --project "$PROJECT" --update-env-vars "TASK_SERVICE_URL=$url" --quiet
  run gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" --project "$PROJECT" \
    --member "serviceAccount:$TASKS_SA" --role roles/run.invoker --quiet
}

require_web_env() {
  $DRY_RUN && return 0
  local name missing=()
  for name in VITE_FIREBASE_API_KEY VITE_FIREBASE_AUTH_DOMAIN VITE_FIREBASE_APP_ID; do
    [[ -n "${!name:-}" ]] || missing+=("$name")
  done
  [[ ${#missing[@]} -eq 0 ]] || { echo "Missing for the web build: ${missing[*]}" >&2; exit 1; }
}

build_web() {
  say "Building the web app"
  export VITE_FIREBASE_PROJECT_ID="$PROJECT" VITE_APP_HOST="$APP_HOST"
  unset VITE_API_MOCK VITE_INTERNAL
  run npm --prefix "$ROOT/apps/web" ci --no-audit --no-fund
  run npm --prefix "$ROOT/apps/web" run build
}

deploy_firebase() {
  say "Firebase Hosting + Firestore rules and indexes"
  cd "$ROOT"
  run firebase deploy --only hosting,firestore:rules,firestore:indexes --project "$PROJECT"
}

main() {
  if $DRY_RUN; then echo "DRY RUN: nothing below is executed (project=$PROJECT region=$REGION)"; fi
  require_web_env
  ensure_apis
  ensure_firestore
  ensure_bucket
  ensure_queue
  ensure_service_accounts
  grant_api_permissions
  ensure_secret
  deploy_api
  sync_task_url
  build_web
  deploy_firebase
  say "Done"
  echo "API (Cloud Run): $(service_url)"
  echo "Web (Hosting):   https://${PROJECT}.web.app  and  https://${PROJECT}.firebaseapp.com"
}

main
