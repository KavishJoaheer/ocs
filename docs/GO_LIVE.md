# OCS MÉDECINS Virtual Practice — Go-Live Runbook

One-page checklist for putting the app into daily use on the NAS. Complete every section in order before the first real home visit.

**Stack:** Docker + SQLite (`/data/clinic.db`) — required for billing and inventory together.  
**Deeper deploy guide:** [NAS_DEPLOYMENT.md](../NAS_DEPLOYMENT.md) · [NAS_SQLITE_PRODUCTION.md](NAS_SQLITE_PRODUCTION.md)

---

## 1. Prerequisites (once)

| Item | Done |
|------|------|
| Docker Hub image published (`clinicflow:latest` on push to `main`) | ☐ |
| UGOS Docker project running `docker-compose.yml` + Watchtower | ☐ |
| Persistent volume `clinicflow-data` attached | ☐ |
| `.env` copied from [.env.example](../.env.example) | ☐ |
| VAPID keys set (or generated on first run in `/data/vapid.json`) | ☐ |
| Public access decided (LAN only, or Cloudflare tunnel) | ☐ |

---

## 2. Production environment (NAS `.env`)

These values must be set **before** go-live:

```text
TZ=Indian/Mauritius
USE_POSTGRES=false
DB_PATH=/data/clinic.db

# Keep false after go-live — prevents restarts from overwriting live stock
SEED_OCS_MASTER_STOCK=false
SEED_DOCTOR_STOCK_FROM_OCS=false
```

Do **not** set `DATABASE_URL` or `USE_POSTGRES=true` on the app container.

Optional CORS (if UI is on another host):

```text
CLIENT_ORIGINS=https://your-app.example.com
```

---

## 3. Deploy latest build

After code is merged to `main` and GitHub Actions publishes the image:

```bash
docker compose pull
docker compose up -d
```

Or wait for Watchtower (default poll every 5 minutes).

**Health check** (replace `<NAS_IP>` and port):

```text
http://<NAS_IP>:8080/api/health
```

Expected:

```json
{
  "ok": true,
  "mode": "sqlite",
  "features": { "billing": true, "inventory": true }
}
```

---

## 4. One-time warehouse reset (sandbox → live catalog)

Run **only** when you want a clean OCS master warehouse (removes test items, activity logs, then loads `ocsMasterStockData.js`).

**Requires** `ALLOW_DB_PURGE=true` or the script exits without changes.

```bash
docker exec -e ALLOW_DB_PURGE=true clinicflow-app node src/scripts/purgeAndReseedOcsWarehouse.js
```

Expected console output:

```text
SUCCESS: Sandbox data purged completely.
SUCCESS: Live master stock records seeded accurately.
```

Then open **Inventory** in the app and confirm folders (including Oral Drugs, Investigation) show the master list.

**Append Consumable manifest rows** (spreadsheet extension — upsert by item name, safe to re-run):

```bash
docker exec clinicflow-app node src/scripts/seedOcsConsumablesExtension.js
```

Source matrix: `server/src/config/ocsConsumablesExtension.js`. Updates the shared OCS `inventory` table used by Admin dashboard metrics, Operator stock grid, and Doctor low-stock alerts (no app restart required).

**Remove all items in selected OCS categories** (keeps Consumable; also clears matching doctor-bag SKUs):

```bash
docker exec -e ALLOW_DB_PURGE=true clinicflow-app node src/scripts/purgeOcsInventoryCategories.js
```

Removes: IM Drugs, IV Drugs, Wound Dressing, Oral Drugs, Pediatric Drugs, Investigation.

**Remove all doctor bag rows in every category** (keeps OCS master stock; includes Consumable):

```bash
docker exec -e ALLOW_DB_PURGE=true clinicflow-app node src/scripts/purgeDoctorBagCategories.js
```

**Append IM Drugs manifest rows** (upsert by item name, safe to re-run):

```bash
docker exec clinicflow-app node src/scripts/seedOcsIMDrugsExtension.js
```

Source matrix: `server/src/config/ocsIMDrugsExtension.js`. Same shared `inventory` table — near-expiry dates flow to Doctor mobile alerts after refresh.

**Optional — remove sandbox patients that were soft-deleted:**

```bash
docker exec -e ALLOW_DB_PURGE=true clinicflow-app node src/scripts/purgeSoftDeletedPatients.js
```

The admin **Patients** screen no longer shows a “Recently deleted” tab; soft-deleted rows are hidden from the directory only.

**Optional — permanently remove soft-deleted team accounts (doctors, operators, accountants):**

```bash
docker exec -e ALLOW_DB_PURGE=true clinicflow-app node src/scripts/purgeSoftDeletedTeamAccounts.js
```

Doctors who still have assigned patients are skipped (reported in the script output). The admin **Team operations** screen no longer shows a “Recently deleted” tab; delete still soft-hides accounts in the database until you run this purge.

---

## 5. Security & accounts

| Task | Done |
|------|------|
| Change default passwords for all live users (not `Welcome@123` / seed defaults) | ☐ |
| Confirm operator accounts are read-only unless admin grants time-bound edit access | ☐ |
| Confirm doctors cannot see global revenue (dashboard / live report) | ☐ |
| Admin-only: team operations, patient delete, long-term review flag (operators can update LTR) | ☐ |

---

## 6. Role smoke test (10 minutes per role)

Use a real browser on **phone** and **desktop** for each role.

### Operator

- ☐ Login → dashboard loads (SOS Planning locked)
- ☐ **Patients** → open a patient chart (no “Too few parameter values” error)
- ☐ Cannot add patients; **Edit** only if admin granted access
- ☐ **Billing status** (read-only) loads
- ☐ **Inventory** → OCS master stock visible
- ☐ **Live Activity** loads

### Doctor

- ☐ **My assigned patients** filter shows only their patients
- ☐ Patient profile → consultations / billing scoped to their practice
- ☐ **Billing** → create bill deducts doctor bag stock
- ☐ **Inventory** → medical bag + restock from OCS
- ☐ Mobile home → assigned patients, HCM, roster PDF shortcuts work

### Admin

- ☐ Dashboard shows practice stats including **total revenue**
- ☐ **Live report**, **Team operations**, roster upload
- ☐ Full patient create / edit / delete
- ☐ Inventory adjust / restock / activity history

### Lab tech

- ☐ Lab workspace, patient directory (read), lab reports on profiles

### Accountant

- ☐ **Billing** full access; no global revenue on dashboard summary cards

---

## 7. Automated API audit (optional, from laptop or NAS shell)

Inside the running container or from `server/` with `DB_PATH` pointing at production DB:

```bash
# On NAS
docker exec clinicflow-app node src/scripts/smokeApiAudit.js

# Or locally against a copy of clinic.db
cd server && npm run audit:smoke
```

Expect: `All critical routes OK for every role.`

---

## 8. Daily operations (after go-live)

| Do | Don't |
|----|--------|
| Keep `SEED_OCS_MASTER_STOCK=false` | Turn seeds back on unless disaster recovery |
| Use billing workflow for stock-out (not manual “Sold” on doctor bag) | Run `purgeAndReseedOcsWarehouse` without `ALLOW_DB_PURGE=true` |
| Let Watchtower pull image updates | Set `USE_POSTGRES=true` on NAS |
| Back up Docker volume `clinicflow-data` regularly | Commit `vapid.json` or `.env` secrets to git |

**Backup (example):**

```bash
docker run --rm -v clinicflow-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/clinicflow-data-$(date +%Y%m%d).tar.gz -C /data .
```

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| Patient profile: “Too few parameter values” | Old image before SQL fix | `docker compose pull && docker compose up -d` |
| Inventory empty after deploy | Purge not run or wrong category filter | Run purge script; open **Oral Drugs** / **Investigation** pills |
| Stock quantities reset overnight | `SEED_OCS_MASTER_STOCK=true` | Set to `false`, redeploy |
| Operator cannot edit patient | No active grant | Admin grants operator edit access on patient |
| Push not working | VAPID not configured | Set `VAPID_*` in `.env` or add to Home Screen (iOS) |

---

## 10. Go / no-go

**Go** when all are true:

1. Health endpoint OK (`mode: sqlite`, `inventory: true`)
2. Warehouse purge completed (if starting fresh)
3. Passwords changed from defaults
4. Role smoke tests pass on mobile and desktop
5. `SEED_*` flags are `false`

**No-go** if patient profiles still error, health check fails, or billing/inventory are disabled.

---

## Related docs

- [NAS_DEPLOYMENT.md](../NAS_DEPLOYMENT.md) — UGOS Docker + Cloudflare
- [NAS_SQLITE_PRODUCTION.md](NAS_SQLITE_PRODUCTION.md) — SQLite production details
- [.env.example](../.env.example) — environment template
