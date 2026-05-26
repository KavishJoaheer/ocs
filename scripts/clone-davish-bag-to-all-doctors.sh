#!/usr/bin/env bash
# Clone Davish Balgobin's medical bag to every other active doctor (production NAS).
# Does not deduct OCS master warehouse stock.
set -euo pipefail

CONTAINER="${CLINICFLOW_CONTAINER:-clinicflow-app}"
USERNAME="${SOURCE_DOCTOR_USERNAME:-dbalgobin}"

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "Preview only (no writes)..."
  docker exec -e DRY_RUN=true -e "SOURCE_DOCTOR_USERNAME=${USERNAME}" "$CONTAINER" \
    node src/scripts/cloneDoctorBagFromTemplate.js
  exit 0
fi

echo "This will DELETE all doctor bag stock and rebuild from ${USERNAME}'s bag."
read -r -p "Type YES to continue: " confirm
if [[ "$confirm" != "YES" ]]; then
  echo "Aborted."
  exit 1
fi

docker exec -e ALLOW_DB_PURGE=true -e "SOURCE_DOCTOR_USERNAME=${USERNAME}" "$CONTAINER" \
  node src/scripts/cloneDoctorBagFromTemplate.js

echo ""
echo "Optional: notify connected apps (admin session required):"
echo "  curl -X POST -H \"Authorization: Bearer <admin-token>\" https://<host>/api/inventory/resync-broadcast"
