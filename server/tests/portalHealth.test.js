const { test } = require("node:test");
const assert = require("node:assert/strict");

test("portal health requires both actual frontends to match the healthy shared API", async () => {
  const { checkPortals } = await import("../../scripts/portal-health-check.mjs");
  let careSha = "tested-sha", missingCareVersion = false, pushConfigured = true;
  const fetcher = async url => {
    if (url.pathname === "/api/health") return { ok: true, json: async () => ({ ok: true, mode: "sqlite", git_sha: "tested-sha", storage: { database_readable: true, data_directory_writable: true, attachments_writable: true } }) };
    if (url.pathname === "/api/push/vapid-public-key") return { ok: true, json: async () => ({ configured: pushConfigured, publicKey: pushConfigured ? "public-test-key" : null }) };
    const care = url.hostname === "care.test";
    return { ok: true, json: async () => {
      if (care && missingCareVersion) throw new SyntaxError("HTML fallback");
      return { portal: care ? "care" : "staff", git_sha: care ? careSha : "tested-sha" };
    } };
  };
  const run = expectedSha => checkPortals({ staff: "https://staff.test", care: "https://care.test", fetcher, expectedSha });
  assert.equal((await run()).ok, true);
  careSha = "old-sha";
  let result = await run(); assert.equal(result.ok, false); assert.ok(result.checks.some(check => check.portal === "care" && check.check === "Frontend release" && !check.ok));
  careSha = "tested-sha"; missingCareVersion = true;
  result = await run(); assert.equal(result.ok, false); assert.ok(result.checks.some(check => check.detail.includes("older release")));
  missingCareVersion = false; pushConfigured = false; assert.equal((await run()).ok, false);
  pushConfigured = true; assert.equal((await run("different-sha")).ok, false);
});
