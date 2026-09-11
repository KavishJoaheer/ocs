#!/usr/bin/env bash
# One-command NAS / local Docker deploy (full SQLite stack).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install Docker or OrbStack first."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop or OrbStack, then run again."
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example — review APP_PORT and DOCKERHUB_USERNAME before production."
fi

# shellcheck disable=SC1091
set -a
source .env 2>/dev/null || true
set +a
APP_PORT="${APP_PORT:-8080}"
APP_IMAGE_TAG="${APP_IMAGE_TAG:-latest}"
export APP_IMAGE_TAG

MODE="${1:-local}"
EXPECTED_DEPLOY_SHA=""

if [[ "$MODE" == "hub" ]]; then
  if [[ "${APP_IMAGE_TAG}" == "latest" || "${APP_IMAGE_TAG}" != sha-* ]]; then
    echo "Warning: APP_IMAGE_TAG is not yet pinned to a tested sha-<commit> tag."
  else
    EXPECTED_DEPLOY_SHA="${APP_IMAGE_TAG#sha-}"
  fi
  if docker container inspect clinicflow-app >/dev/null 2>&1; then
    if [[ -z "${OCS_BACKUP_DIR:-}" ]]; then
      echo "Warning: OCS_BACKUP_DIR is not configured; the verified off-volume backup is deferred."
    else
      mkdir -p "${OCS_BACKUP_DIR}"
      CURRENT_IMAGE_ID="$(docker container inspect --format '{{.Image}}' clinicflow-app)"
      echo "Creating a verified pre-deployment backup..."
      docker run --rm \
        -e DB_PATH=/data/clinic.db \
        -e BACKUP_DIR=/backup \
        -v clinicflow-data:/data \
        -v "${OCS_BACKUP_DIR}:/backup" \
        "${CURRENT_IMAGE_ID}" \
        node src/scripts/backupClinicData.js
    fi
  fi
  echo "Starting Docker Hub image ${APP_IMAGE_TAG} (docker-compose.yml)..."
  docker compose pull
  docker compose up -d
else
  echo "Building and starting from source (docker-compose.local.yml)..."
  docker compose -f docker-compose.local.yml up -d --build
fi

echo "Waiting for health check..."
for i in $(seq 1 30); do
  if EXPECTED_GIT_SHA="${EXPECTED_DEPLOY_SHA}" node scripts/docker-health-check.mjs "http://127.0.0.1:${APP_PORT}" 2>/dev/null; then
    echo ""
    echo "Ready: http://127.0.0.1:${APP_PORT}"
    echo "Health: http://127.0.0.1:${APP_PORT}/api/health"
    exit 0
  fi
  sleep 2
done

echo "Container started but health check did not pass yet. Run:"
echo "  npm run docker:logs"
echo "  npm run docker:health"
exit 1
