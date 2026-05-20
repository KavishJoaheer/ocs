# Production: Docker + SQLite (full billing & inventory)

This is the **recommended** production setup for OCS. One container runs the full Express API, React UI, and SQLite database with persistent storage.

## What you get

- `POST /api/billing` deducts doctor bag stock (FEFO batches, movements)
- Full `/api/inventory` (master stock, restock, low-stock alerts)
- Data persists in Docker volume `clinicflow-data` at `/data/clinic.db`
- Push notifications (VAPID keys in `/data/vapid.json` or env)

## Quick start (build on NAS or laptop)

```bash
cp .env.example .env
# Edit APP_PORT, optional VAPID_* and CLIENT_ORIGINS

docker compose -f docker-compose.local.yml up -d --build
```

Open:

- App: `http://<host>:8080`
- Health: `http://<host>:8080/api/health`

Expected health response:

```json
{
  "ok": true,
  "mode": "sqlite",
  "database": "/data/clinic.db",
  "features": {
    "billing": true,
    "inventory": true,
    "consultations": true,
    "push": true
  }
}
```

## NAS deployment (Docker Hub image)

1. Publish image: push to `main` → GitHub Actions → `docker.io/<user>/clinicflow:latest`
2. On UGOS: deploy [docker-compose.yml](../docker-compose.yml) with your `.env`
3. **Do not** set `DATABASE_URL`, `POSTGRES_URL`, or `USE_POSTGRES=true` on the app service
4. Expose via LAN (`APP_PORT`) or [Cloudflare tunnel](../NAS_DEPLOYMENT.md)

## Frontend on Vercel + API on NAS (optional)

1. Deploy backend with Docker (steps above) and a public URL (tunnel or domain).
2. In Vercel project settings → Environment Variables:

   ```text
   VITE_API_BASE=https://your-public-host/api
   ```

3. Use [vercel.static.json](../vercel.static.json) as your Vercel config (SPA only, **no** `/api` serverless) — rename or merge into `vercel.json` and remove the `api/` folder from the Vercel project root if present.

4. On the NAS container, set CORS:

   ```text
   CLIENT_ORIGINS=https://your-project.vercel.app
   ```

## What not to use for clinic operations

| Setup | Billing + inventory |
|--------|---------------------|
| Docker + SQLite (`docker-compose.yml`) | Yes |
| Vercel + `USE_POSTGRES=true` | Billing only, no inventory |
| Vercel serverless without Postgres | Ephemeral `/tmp` SQLite (data loss) |

## Commands

```bash
# Local / NAS build from source
npm run docker:up
npm run docker:down
npm run docker:logs

# Pull published image (NAS production)
docker compose up -d
```

## Troubleshooting

- **Health fails `inventory` check** — wrong image or `USE_POSTGRES=true`; redeploy with `USE_POSTGRES=false`.
- **CORS errors from phone** — set `CLIENT_ORIGINS` to your exact frontend URL (scheme + host).
- **Stock resets on restart** — set `SEED_OCS_MASTER_STOCK=false` and `SEED_DOCTOR_STOCK_FROM_OCS=false` in `.env`.
