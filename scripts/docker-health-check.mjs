#!/usr/bin/env node
/**
 * Verify the Docker/NAS API is running full SQLite mode with inventory.
 * Usage: node scripts/docker-health-check.mjs [baseUrl]
 * Default baseUrl: http://127.0.0.1:8080
 */

const base = (process.argv[2] || process.env.OCS_HEALTH_URL || "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);

async function main() {
  const url = `${base}/api/health`;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error(`FAIL: ${url} returned ${res.status}`);
    process.exit(1);
  }

  if (body.mode !== "sqlite") {
    console.error(`FAIL: expected mode=sqlite, got ${body.mode}`);
    process.exit(1);
  }

  if (!body.features?.billing || !body.features?.inventory) {
    console.error("FAIL: billing or inventory feature flag missing", body.features);
    process.exit(1);
  }

  console.log("OK:", url);
  console.log(JSON.stringify(body, null, 2));
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
