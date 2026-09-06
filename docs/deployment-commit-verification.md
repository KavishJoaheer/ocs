# Deployment commit verification

The GitHub Actions `CI` workflow is the required quality gate. A production-tagged Docker image is published only after that workflow succeeds for the exact commit SHA.

This repository does not deploy to the NAS. If the live site still pulls `:latest` independently of CI, update the external pull/restart configuration as follows:

1. Wait for GitHub Actions `CI` and `Publish Docker Image` to succeed for the intended commit.
2. Pull the SHA-tagged image, not an unverified `latest` from a failed or skipped pipeline:
   - `docker.io/<DOCKERHUB_USERNAME>/clinicflow:sha-<12-char-sha>`
   - or `docker.io/<DOCKERHUB_USERNAME>/clinicflow:sha-<full-sha>`
3. After restart, confirm the running API reports the same commit:
   - `GET /api/health` must include `"git_sha": "<full tested SHA>"`
   - Reject the deploy if `git_sha` is missing or does not match the tested commit.
4. Do not promote an image when any required CI job failed or was skipped.

No production database was modified by this repository change. Apply the restock foreign-key repair by restarting the API so `initializeDatabase()` / `migrateRestockRequestsSchemaIfNeeded()` can run against the operational SQLite file.
