import test from "node:test";
import assert from "node:assert/strict";

import { canAccessPath } from "./access.js";

test("operators can open the consultation record used for manual invoice photos", () => {
  assert.equal(canAccessPath("operator", "/consultations"), true);
  assert.equal(canAccessPath("operator", "/consultations/421"), true);
});
