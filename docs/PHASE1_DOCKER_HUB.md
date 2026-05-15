# Phase 1 — Publish the Docker image to Docker Hub

This repo builds and pushes `docker.io/<your-username>/clinicflow:latest` from GitHub Actions ([.github/workflows/docker-publish.yml](../.github/workflows/docker-publish.yml)). Complete the steps below once; after that, every push to `main` republishes the image.

## 1. Docker Hub repository

1. Sign in at [https://hub.docker.com](https://hub.docker.com) (create an account if needed). Note your **username** — it must match what you set as `DOCKERHUB_USERNAME` on GitHub and on the NAS.
2. **Repositories** → **Create repository**.
3. **Name**: `clinicflow` (required — the workflow image name is fixed to `clinicflow`).
4. **Visibility**: **Public** (simplest for the NAS to pull without registry credentials).
5. Create the repository.

## 2. Docker Hub access token

1. Avatar → **Account settings** → **Personal access tokens**.
2. **Generate new token** — description e.g. `github-actions-clinicflow`.
3. Permissions: at least **Read & Write** (push needs write).
4. Copy the token once it is shown and store it securely. You will paste it into GitHub only.

## 3. GitHub repository secrets

In your GitHub repo: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

| Name | Value |
|------|--------|
| `DOCKERHUB_USERNAME` | Your Docker Hub username (same as in the image URL). |
| `DOCKERHUB_TOKEN` | The personal access token from step 2 (not your Docker Hub password). |

Names must match exactly (the workflow reads `secrets.DOCKERHUB_USERNAME` and `secrets.DOCKERHUB_TOKEN`).

## 4. Run the workflow

- **Option A — Manual run:** **Actions** → **Publish Docker Image** → **Run workflow** → branch `main` → **Run workflow**.
- **Option B — Push to `main`:** Any push to `main` triggers the workflow automatically.

If either secret is missing or empty, the workflow fails fast at **Verify Docker Hub secrets** with a clear error.

## 5. Confirm success

1. In GitHub **Actions**, open the latest **Publish Docker Image** run; the **publish** job should be green.
2. On Docker Hub, open `https://hub.docker.com/r/<username>/clinicflow/tags`.
3. Confirm tags **`latest`** and **`sha-<short>`** exist, with **linux/amd64** and **linux/arm64** on `latest`.

You can then continue with Phase 2–3 in [NAS_DEPLOYMENT.md](../NAS_DEPLOYMENT.md) (NAS Docker + [docker-compose.yml](../docker-compose.yml)).

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| `denied` / `unauthorized` on login | `DOCKERHUB_TOKEN` is wrong, expired, or lacks write scope; or `DOCKERHUB_USERNAME` does not match the token’s account. |
| `repository does not exist` | Create the `clinicflow` repo on Docker Hub under that username, or fix the username secret. |
| Workflow never runs | Default branch must be `main`, or use **Run workflow** manually. |
