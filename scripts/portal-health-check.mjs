#!/usr/bin/env node
import { pathToFileURL } from "node:url";

// Public GETs only. Checking /api/health on both domains is insufficient: both
// proxies can reach the same API while serving different frontend releases.
export async function checkPortals({ staff = "https://staff.ocsvp.com", care = "https://ocsvp.com", expectedSha = "", fetcher = fetch } = {}) {
  const checks = [];
  const read = async (origin, path) => {
    const response = await fetcher(new URL(path, origin), { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    try { return await response.json(); }
    catch { throw new Error(`${path} does not return JSON; this portal may be serving an older release`); }
  };
  const portals = await Promise.all([["staff", staff], ["care", care]].map(async ([name, origin]) => {
    const results = await Promise.allSettled([read(origin, "/api/health"), read(origin, "/version.json"), read(origin, "/api/push/vapid-public-key")]);
    const [health, version, push] = results.map((result, i) => {
      if (result.status === "fulfilled") return result.value;
      checks.push({ portal: name, check: ["API health", "Frontend version", "Push configuration"][i], ok: false, detail: result.reason.message });
      return null;
    });
    return { name, health, version, push };
  }));
  const target = expectedSha || portals.find(portal => portal.name === "staff")?.health?.git_sha;
  for (const { name, health, version, push } of portals) {
    if (health) checks.push({ portal: name, check: "API health", ok: Boolean(health.ok && health.mode === "sqlite" && health.storage?.database_readable && health.storage?.data_directory_writable && health.storage?.attachments_writable), detail: health.git_sha || "Missing API version" });
    if (health) checks.push({ portal: name, check: "API release", ok: Boolean(target && health.git_sha === target), detail: health.git_sha || "Missing API version" });
    if (version) checks.push({ portal: name, check: "Frontend release", ok: Boolean(target && version.git_sha === target && version.portal === name), detail: version.git_sha || "Missing frontend version" });
    if (push) checks.push({ portal: name, check: "Push configuration", ok: push.configured === true && Boolean(push.publicKey), detail: push.configured ? "Configured; actual device delivery still needs a device check" : "Not configured" });
  }
  return { ok: checks.every(check => check.ok), expected_sha: target || null, checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await checkPortals({ staff: process.env.OCS_STAFF_HEALTH_URL, care: process.env.OCS_CARE_HEALTH_URL, expectedSha: process.env.EXPECTED_GIT_SHA });
    for (const check of result.checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.portal} · ${check.check}: ${check.detail}`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}
