# UGOS Docker Project Deployment Guide

This project is prepared for a registry-first deployment flow that works well with UGREEN NAS systems running UGOS and the Docker Project GUI.

## Deployment Architecture

The deployment flow is:

1. You push code from your laptop to GitHub.
2. GitHub Actions builds the production Docker image.
3. GitHub Actions pushes that image to Docker Hub.
4. UGOS Docker Project pulls the image from Docker Hub.
5. Watchtower on the NAS checks Docker Hub and updates only this app container when a new image is available.
6. A separate `cloudflared` container creates a public Cloudflare Quick Tunnel for testing.

This avoids copying source code to the NAS and avoids needing shell access or `git pull` on the NAS.

## What This App Runs As

This is a Node.js production container, not a frontend-only static image.

- The React frontend is built during the Docker image build.
- The Express server serves both the API and the built frontend.
- SQLite is stored in a persistent Docker volume at `/data/clinic.db`.

## Files To Use

- [Dockerfile](/C:/Users/kavis/OneDrive/Desktop/varun/Dockerfile)
- [.dockerignore](/C:/Users/kavis/OneDrive/Desktop/varun/.dockerignore)
- [docker-compose.yml](/C:/Users/kavis/OneDrive/Desktop/varun/docker-compose.yml)
- [docker-compose.cloudflare.yml](/C:/Users/kavis/OneDrive/Desktop/varun/docker-compose.cloudflare.yml)
- [.github/workflows/docker-publish.yml](/C:/Users/kavis/OneDrive/Desktop/varun/.github/workflows/docker-publish.yml)
- [.env.example](/C:/Users/kavis/OneDrive/Desktop/varun/.env.example)

## Before You Start

You should do these things once:

1. Create a Docker Hub account if you do not already have one.
2. Create a Docker Hub repository named `clinicflow`.
3. Make that Docker Hub repository public for the easiest UGOS and Watchtower setup.
4. Push this repository to GitHub.

## GitHub Setup

In GitHub, open your repository and create these repository secrets:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

Use a Docker Hub access token, not your normal password.

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

Use [docker-compose.yml](/C:/Users/kavis/OneDrive/Desktop/varun/docker-compose.yml) for the main app deployment.

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

## Cloudflare Tunnel Project

Use [docker-compose.cloudflare.yml](/C:/Users/kavis/OneDrive/Desktop/varun/docker-compose.cloudflare.yml) for the public test tunnel.

This file uses a Cloudflare Quick Tunnel, which is the right choice if you do not want to use a custom domain yet.

For this Quick Tunnel setup, you do not need to paste anything into the Cloudflare dashboard.

The internal URL the Cloudflare container sends traffic to is:

```text
http://clinicflow-app:3001
```

That is the exact origin value to use because the Cloudflare container joins the same Docker network as the app container.

If you later move to a named Cloudflare Tunnel with your own domain, the service URL to enter in the Cloudflare dashboard is still:

```text
http://clinicflow-app:3001
```

Quick Tunnel notes:

- the public URL is random
- the public URL changes if the tunnel container is recreated
- it is good for testing, not a permanent production setup

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
3. Copy the contents of [docker-compose.yml](/C:/Users/kavis/OneDrive/Desktop/varun/docker-compose.yml).
4. Paste it into the compose editor.
5. If UGOS offers an environment variables section, set:

```text
DOCKERHUB_USERNAME=<your-dockerhub-username>
APP_IMAGE_NAME=clinicflow
APP_PORT=8080
TZ=Indian/Mauritius
WATCHTOWER_POLL_INTERVAL=300
```

6. If UGOS instead supports an `.env` file, use [.env.example](/C:/Users/kavis/OneDrive/Desktop/varun/.env.example) as your template.
7. Deploy the project.
8. Wait until both `clinicflow-app` and `clinicflow-watchtower` show as running.
9. Open:

```text
http://<NAS_IP>:8080
```

### Part 3: Create the Cloudflare tunnel project in UGOS

1. Go to `Project` -> `Create` again.
2. Copy the contents of [docker-compose.cloudflare.yml](/C:/Users/kavis/OneDrive/Desktop/varun/docker-compose.cloudflare.yml).
3. Paste it into the compose editor.
4. If UGOS offers environment variables, optionally set:

```text
CLOUDFLARE_TUNNEL_URL=http://clinicflow-app:3001
```

5. Deploy the project.
6. Open the logs for the `clinicflow-cloudflared` container.
7. Find the generated `https://...trycloudflare.com` URL in the logs.
8. Open that URL in a browser to test the public tunnel.

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
3. Confirm the tunnel target is:

```text
http://clinicflow-app:3001
```

4. Confirm `http://<NAS_IP>:8080/api/health` works locally on your LAN first.
5. If the tunnel URL changed, reopen the `clinicflow-cloudflared` logs and copy the newest `trycloudflare.com` address.

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

and that [server/src/index.js](/C:/Users/kavis/OneDrive/Desktop/varun/server/src/index.js) is using `app.listen(PORT, HOST)`.
