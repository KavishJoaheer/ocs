# Deploy OCS (do this once)

## On your NAS or server (recommended)

1. Install Docker on the NAS (UGOS Docker app).
2. Copy this repo to the NAS, or use Docker Hub after pushing `main`.
3. Run:

```bash
chmod +x scripts/nas-deploy.sh
./scripts/nas-deploy.sh          # build from source
# or
./scripts/nas-deploy.sh hub      # pull clinicflow:latest from Docker Hub
```

4. Open `http://<NAS-IP>:8080` and log in (`Welcome@123` for seeded users).
5. Confirm: `http://<NAS-IP>:8080/api/health` shows `"mode":"sqlite"` and `"inventory":true`.

## On your laptop (test before NAS)

1. Start Docker Desktop or OrbStack.
2. Run `./scripts/nas-deploy.sh` or `npm run docker:up`.
3. Run `npm run docker:health`.

## Public URL (phone / PWA)

Use [NAS_DEPLOYMENT.md](NAS_DEPLOYMENT.md) Part 4 — Cloudflare Named Tunnel pointing to `http://clinicflow-app:3001`.

Set on the app container if the UI is on another host:

```text
CLIENT_ORIGINS=https://your-tunnel-domain.com
```

## Do not use for production clinic data

- Vercel serverless API with Postgres (`USE_POSTGRES=true`) — no inventory sync.
- Vercel without Docker — ephemeral database.

Details: [docs/NAS_SQLITE_PRODUCTION.md](docs/NAS_SQLITE_PRODUCTION.md).
