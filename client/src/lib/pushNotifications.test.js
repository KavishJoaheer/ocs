import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("./pushNotifications.js", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "").replace(/^export /gm, "");

function device(subscription, remove = async () => ({})) {
  const calls = [];
  const sandbox = {
    window: { PushManager: {}, Notification: {} },
    navigator: { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => subscription } }) } },
    api: { delete: async (...args) => { calls.push(args); return remove(...args); } },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nthis.unsubscribe = unsubscribeFromPushNotifications;`, sandbox);
  return { unsubscribe: sandbox.unsubscribe, calls };
}

test("turning off alerts captures the current endpoint before the browser removes it", async () => {
  let removed = false;
  const subscription = { endpoint: "https://example.invalid/this-phone", unsubscribe: async () => {
    removed = true; subscription.endpoint = null; return true;
  } };
  const current = device(subscription);
  await current.unsubscribe();
  assert.equal(removed, true);
  assert.equal(current.calls.length, 1);
  assert.equal(current.calls[0][0], "/push/subscribe");
  assert.equal(current.calls[0][1].body.endpoint, "https://example.invalid/this-phone");
});

test("a device without a subscription never clears other devices", async () => {
  const current = device(null);
  await current.unsubscribe();
  assert.equal(current.calls.length, 0);
});

test("browser unsubscribe failure leaves the server subscription alone", async () => {
  const current = device({ endpoint: "https://example.invalid/phone", unsubscribe: async () => { throw new Error("Browser unavailable"); } });
  await assert.rejects(current.unsubscribe(), /Browser unavailable/);
  assert.equal(current.calls.length, 0);
});

test("offline server cleanup does not undo a successful local disable or clear other devices", async () => {
  let removed = false;
  const current = device({ endpoint: "https://example.invalid/phone", unsubscribe: async () => { removed = true; } }, async () => { throw new Error("Offline"); });
  await current.unsubscribe();
  assert.equal(removed, true);
  assert.equal(current.calls.length, 1);
  assert.equal(current.calls[0][1].body.endpoint, "https://example.invalid/phone");
});
