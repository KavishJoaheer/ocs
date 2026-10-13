import assert from "node:assert/strict";
import test from "node:test";
import { getBottomNavItemsForRole } from "./bottomNavItems.js";

test("operator mobile navigation opens the dashboard, patient intake and reviews", () => {
  const paths = getBottomNavItemsForRole("operator").map((item) => item.to);

  assert.deepEqual(paths, [
    "/",
    "/patients/add",
    "/operator/long-term-review",
  ]);
});

test("operator secondary desktop areas remain absent from mobile navigation", () => {
  const paths = new Set(getBottomNavItemsForRole("operator").map((item) => item.to));

  for (const path of [
    "/patients",
    "/visit-requests",
    "/billing",
    "/operator/pending-payment",
    "/inventory",
    "/stock-history",
    "/hcm-news",
  ]) {
    assert.equal(paths.has(path), false);
  }
});
