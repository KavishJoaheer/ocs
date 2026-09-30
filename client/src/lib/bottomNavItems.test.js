import assert from "node:assert/strict";
import test from "node:test";
import { getBottomNavItemsForRole } from "./bottomNavItems.js";

test("operator mobile navigation only contains daily operation actions", () => {
  const paths = getBottomNavItemsForRole("operator").map((item) => item.to);

  assert.deepEqual(paths, [
    "/patients",
    "/patients/add",
    "/visit-requests",
    "/operator/long-term-review",
  ]);
});

test("operator desktop-only areas are absent from mobile navigation", () => {
  const paths = new Set(getBottomNavItemsForRole("operator").map((item) => item.to));

  for (const path of [
    "/operator/pending-payment",
    "/billing",
    "/inventory",
    "/stock-history",
    "/hcm-news",
  ]) {
    assert.equal(paths.has(path), false);
  }
});
