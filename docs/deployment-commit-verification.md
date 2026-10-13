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

Deploy `app`, `patient-portal` and `linkham-portal` together with the same tested SHA tag. Both short (12-character) and full SHA tags are published for all three images. Updating only `app` can leave the live Care interface behind even though both domains' `/api/health` endpoints report the new API.

After deploying this release, run `npm run health:portals` for a read-only check of the public VP and Care sites. It verifies API/database/storage health, push configuration and each frontend's independently built `/version.json`. Every frontend must match the API commit. Set `EXPECTED_GIT_SHA` to require a particular full commit; `OCS_STAFF_HEALTH_URL` and `OCS_CARE_HEALTH_URL` override the default public domains. Missing version metadata fails the check rather than declaring an older portal healthy.

`npm run deploy:nas:hub` also verifies the patient portal container's frontend version against the API before reporting readiness. This catches mixed releases inside Docker; the public check additionally catches an outdated proxy target or cached app origin. Push configuration does not verify delivery to a particular phone or actual WhatsApp calls.

No production database was modified by this repository change. Apply the restock foreign-key repair by restarting the API so `initializeDatabase()` / `migrateRestockRequestsSchemaIfNeeded()` can run against the operational SQLite file.
