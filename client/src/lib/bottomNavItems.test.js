import assert from "node:assert/strict";
import test from "node:test";
import { getBottomNavItemsForRole } from "./bottomNavItems.js";

test("operator mobile navigation includes billing with daily operation actions", () => {
  const paths = getBottomNavItemsForRole("operator").map((item) => item.to);

  assert.deepEqual(paths, [
    "/patients",
    "/patients/add",
    "/visit-requests",
    "/billing",
    "/operator/long-term-review",
  ]);
});

test("operator secondary desktop areas remain absent from mobile navigation", () => {
  const paths = new Set(getBottomNavItemsForRole("operator").map((item) => item.to));

  for (const path of [
    "/operator/pending-payment",
    "/inventory",
    "/stock-history",
    "/hcm-news",
  ]) {
    assert.equal(paths.has(path), false);
  }
});
