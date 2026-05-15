# UGOS Docker Project Deployment Guide

This project is prepared for a registry-first deployment flow that works well with UGREEN NAS systems running UGOS and the Docker Project GUI.

## Deployment Architecture

The deployment flow is:

1. You push code from your laptop to GitHub.
2. GitHub Actions builds the production Docker image.
3. GitHub Actions pushes that image to Docker Hub.
4. UGOS Docker Project pulls the image from Docker Hub.
5. Watchtower on the NAS checks Docker Hub and updates only this app container when a new image is available.
6. A separate `cloudflared` Docker project exposes the app: either a **Quick Tunnel** (random URL, testing) or a **Named Tunnel** (your domain, production). See [docker-compose.cloudflare.yml](docker-compose.cloudflare.yml) and [docker-compose.cloudflare.named.yml](docker-compose.cloudflare.named.yml).

This avoids copying source code to the NAS and avoids needing shell access or `git pull` on the NAS.

## What This App Runs As

This is a Node.js production container, not a frontend-only static image.

- The React frontend is built during the Docker image build.
- The Express server serves both the API and the built frontend.
- SQLite is stored in a persistent Docker volume at `/data/clinic.db`.

## Files To Use

- [Dockerfile](Dockerfile)
- [.dockerignore](.dockerignore)
- [docker-compose.yml](docker-compose.yml)
- [docker-compose.cloudflare.yml](docker-compose.cloudflare.yml) (Quick Tunnel)
- [docker-compose.cloudflare.named.yml](docker-compose.cloudflare.named.yml) (Named Tunnel / custom domain)
- [.github/workflows/docker-publish.yml](.github/workflows/docker-publish.yml)
- [.env.example](.env.example)

## Before You Start

You should do these things once:

1. Create a Docker Hub account if you do not already have one.
2. Create a Docker Hub repository named `clinicflow`.
3. Make that Docker Hub repository public for the easiest UGOS and Watchtower setup.
4. Push this repository to GitHub.
5. Configure GitHub Actions secrets, run **Publish Docker Image**, and confirm `latest` on Docker Hub: [docs/PHASE1_DOCKER_HUB.md](docs/PHASE1_DOCKER_HUB.md).

## GitHub Setup

Step-by-step checklist (Docker Hub repo, token, secrets, first run, verification): [docs/PHASE1_DOCKER_HUB.md](docs/PHASE1_DOCKER_HUB.md).

In GitHub, open your repository and create these repository secrets:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

Use a Docker Hub access token, not your normal password. If either secret is missing, the **Publish Docker Image** workflow fails at **Verify Docker Hub secrets** with an explicit error.

## GitHub Actions Result

Every push to the `main` branch will:

- build the Docker image
- push `latest`
- push a `sha-<commit>` tag

Your image name will be:

```text
docker.io/<your-dockerhub-username>/clinicflow:latest
```

## UGOS App Project

Use [docker-compose.yml](docker-compose.yml) for the main app deployment.

Important values:

- `APP_PORT`
  This is the NAS LAN port you will open in your browser.
  Example: `8080`
- `DOCKERHUB_USERNAME`
  This must match your Docker Hub username.
- `APP_IMAGE_NAME`
  Leave this as `clinicflow` unless you changed the repo name on Docker Hub.

The app will listen inside Docker on:

```text
http://clinicflow-app:3001
```

The app will be reachable on your LAN at:

```text
http://<NAS_IP>:8080
```

## Cloudflare Tunnel Projects

Run **only one** Cloudflare Docker project at a time (both use `clinicflow-cloudflared` as the container name). Deploy the main app stack first so the shared network `clinicflow-public` exists.

Inside Docker, traffic always goes to the app at:

```text
http://clinicflow-app:3001
```

The `cloudflared` container joins `clinicflow-public`, same as `clinicflow-app`, so that hostname resolves on the Docker network.

### Quick Tunnel (testing)

Use [docker-compose.cloudflare.yml](docker-compose.cloudflare.yml). No Cloudflare dashboard configuration. The public URL is random (`*.trycloudflare.com`) and changes if the container is recreated.

### Named Tunnel (custom domain, production)

Use [docker-compose.cloudflare.named.yml](docker-compose.cloudflare.named.yml). You create the tunnel and hostnames in **Cloudflare Zero Trust**; the NAS only runs `cloudflared` with a **connector token**.

In the Zero Trust dashboard, when you add a **Public hostname**, set the service to:

```text
http://clinicflow-app:3001
```

Use **HTTP** (not HTTPS) for that service URL — TLS terminates at Cloudflare; the hop from `cloudflared` to the app is inside your NAS Docker network.

## Step-By-Step UGOS Deployment

### Part 1: Publish the image from GitHub

1. Add the GitHub secrets listed above.
2. Push this repo to the `main` branch.
3. Open GitHub `Actions`.
4. Wait for the `Publish Docker Image` workflow to succeed.
5. Confirm that `docker.io/<your-dockerhub-username>/clinicflow:latest` exists on Docker Hub.

### Part 2: Create the main app project in UGOS

1. Open the UGOS Docker app.
2. Go to `Project` -> `Create`.
3. Copy the contents of [docker-compose.yml](docker-compose.yml).
4. Paste it into the compose editor.
5. If UGOS offers an environment variables section, set:

```text
DOCKERHUB_USERNAME=<your-dockerhub-username>
APP_IMAGE_NAME=clinicflow
APP_PORT=8080
TZ=Indian/Mauritius
WATCHTOWER_POLL_INTERVAL=300
```

6. If UGOS instead supports an `.env` file, use [.env.example](.env.example) as your template.
7. Deploy the project.
8. Wait until both `clinicflow-app` and `clinicflow-watchtower` show as running.
9. Open:

```text
http://<NAS_IP>:8080
```

### Part 3: Create the Cloudflare tunnel project in UGOS (Quick Tunnel)

Use this for a quick public test URL without configuring DNS.

1. Confirm Part 2 is done: `http://<NAS_IP>:8080/api/health` returns OK.
2. Go to `Project` -> `Create`.
3. Name the project e.g. `clinicflow-cloudflare` (any name is fine).
4. Copy the full contents of [docker-compose.cloudflare.yml](docker-compose.cloudflare.yml) into the compose editor.
5. Environment variables (optional; defaults match the app):

```text
CLOUDFLARE_TUNNEL_URL=http://clinicflow-app:3001
```

6. Deploy the project.
7. Open logs for `clinicflow-cloudflared`.
8. Copy the `https://...trycloudflare.com` URL from the logs and open it in a browser.

### Part 4: Cloudflare Named Tunnel (custom domain)

Use this when your domain’s DNS is on Cloudflare (for example `ocsvp.com`) and you want a stable public URL.

**A. Create the tunnel in Cloudflare**

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com) → select your zone → **Zero Trust** (or go to [one.dash.cloudflare.com](https://one.dash.cloudflare.com)).
2. **Networks** → **Tunnels** → **Create a tunnel**.
3. Choose **Cloudflared**, name the tunnel (e.g. `clinicflow-nas`), **Save tunnel**.
4. On the **Install connector** step, open the **Docker** tab. The command looks like:

```text
docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token eyJhIjoi...
```

5. Copy only the long string after `--token` — that is `TUNNEL_TOKEN`. Do not commit it to git.

**B. Public hostnames**

Still in the tunnel wizard (or **Configure** → **Public Hostname**):

- **Subdomain** / **Domain**: e.g. `app` + `ocsvp.com`, or `@` for apex — whatever you want public.
- **Service type**: **HTTP**
- **URL**: `clinicflow-app:3001` (Cloudflare accepts hostname:port; this is the Docker service name on `clinicflow-public`).

Save. Cloudflare creates the DNS records pointing at the tunnel.

**C. Deploy the connector on the NAS**

1. Stop or remove any existing Quick Tunnel project that uses `clinicflow-cloudflared` so the name does not conflict.
2. UGOS **Project** → **Create** (e.g. `clinicflow-cloudflare-named`).
3. Paste the contents of [docker-compose.cloudflare.named.yml](docker-compose.cloudflare.named.yml).
4. Set environment variable:

```text
TUNNEL_TOKEN=<paste the token from step A.5>
```

5. Deploy. In tunnel logs you should see connections registered; in Zero Trust the tunnel status should become **Healthy**.
6. Under **SSL/TLS** → **Overview**, set encryption mode to **Full** for the zone (edge to origin is encrypted via the tunnel; the local hop is HTTP inside Docker).

If the site does not load, confirm LAN access first (`http://<NAS_IP>:8080`), then confirm the public hostname service URL is exactly `http://clinicflow-app:3001` (or `http://clinicflow-app:3001/` depending on the UI).

## First Login

Seeded admin login:

```text
Username: shravan.joaheer
Password: Welcome@123
```

## Troubleshooting

### NAS container starts but website does not load

Check these in order:

1. Confirm `clinicflow-app` is running and healthy in UGOS.
2. Confirm the published port is correct:

```text
APP_PORT=8080
```

3. Open `http://<NAS_IP>:8080/api/health`.
4. If that works but the UI does not, open `http://<NAS_IP>:8080` again and inspect the app logs.
5. Make sure the image actually contains the built frontend and that the workflow succeeded.

### Watchtower does not update

Check these in order:

1. Confirm the new image was actually pushed to Docker Hub.
2. Confirm the app image tag is still `latest`.
3. Confirm the app container has this label:

```text
com.centurylinklabs.watchtower.enable=true
```

4. Confirm Watchtower is started with `--label-enable`.
5. Wait at least `WATCHTOWER_POLL_INTERVAL` seconds.
6. If you used a private Docker Hub repository, Watchtower may not be able to pull it without registry credentials on the NAS. Public is easiest.

### Cloudflare tunnel is up but the site is unreachable

Check these in order:

1. Confirm the app project was deployed before the Cloudflare project.
2. Confirm both projects use the shared Docker network named `clinicflow-public`.
3. Confirm the tunnel target (Quick Tunnel env or Named Tunnel public hostname) is:

```text
http://clinicflow-app:3001
```

4. Confirm `http://<NAS_IP>:8080/api/health` works locally on your LAN first.
5. **Quick Tunnel only:** if the public URL changed, reopen `clinicflow-cloudflared` logs and copy the newest `trycloudflare.com` address.
6. **Named Tunnel only:** confirm `TUNNEL_TOKEN` is set on the NAS project, the tunnel shows **Healthy** in Zero Trust, and DNS for your hostname points to the tunnel (check **DNS** → **Records**). Expired or wrong tokens show auth errors in `cloudflared` logs.

### Wrong port mapping

The container listens internally on port `3001`.

The NAS port published to your LAN is:

```text
APP_PORT=8080
```

The correct mapping is:

```text
8080:3001
```

If you change `APP_PORT`, the left side changes. The right side should stay `3001`.

### App binds only to localhost instead of 0.0.0.0

This project is already configured for Docker with:

```text
HOST=0.0.0.0
PORT=3001
```

If you ever see logs showing only localhost behavior, confirm the running container still has:

```text
HOST=0.0.0.0
```

and that [server/src/index.js](server/src/index.js) is using `app.listen(PORT, HOST)`.
