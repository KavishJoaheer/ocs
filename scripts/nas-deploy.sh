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

MODE="${1:-local}"

if [[ "$MODE" == "hub" ]]; then
  echo "Starting from Docker Hub image (docker-compose.yml)..."
  docker compose up -d
else
  echo "Building and starting from source (docker-compose.local.yml)..."
  docker compose -f docker-compose.local.yml up -d --build
fi

echo "Waiting for health check..."
for i in $(seq 1 30); do
  if node scripts/docker-health-check.mjs "http://127.0.0.1:${APP_PORT}" 2>/dev/null; then
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
