const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness(post = async () => ({ token: "synthetic" })) {
  const events = [], sources = [], timers = new Map(); let timerId = 0;
  class Source {
    constructor(url) { this.url = url; this.handlers = {}; this.closed = false; sources.push(this); }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    close() { this.closed = true; }
  }
  const sandbox = {
    api: { post }, EventSource: Source, CustomEvent: class { constructor(type) { this.type = type; } },
    window: { dispatchEvent: event => events.push(event.type), setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } },
  };
  const source = fs.readFileSync(path.resolve(__dirname, "../../patient-portal/src/lib/realtime.js"), "utf8")
    .replace(/^import .*;\n/gm, "").replace(/import\.meta\.env\.VITE_API_BASE/g, '"/api"').replace(/\bexport\s+/g, "");
  vm.runInNewContext(`${source}\nglobalThis.start=startPatientRealtime;globalThis.stop=stopPatientRealtime;globalThis.connected=isPatientRealtimeConnected;`, sandbox);
  return { ...sandbox, events, sources, timers };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test("Care reconnect refetches updates missed offline and ignores obsolete streams", async () => {
  const h = harness(); h.start(); await flush();
  h.sources[0].handlers.connected(); assert.equal(h.connected(), true); assert.deepEqual(h.events, ["patient:data"]);
  h.events.length = 0; h.sources[0].onerror(); assert.equal(h.connected(), false);
  for (const [id, fn] of [...h.timers]) { h.timers.delete(id); fn(); } await flush();
  h.sources[1].handlers.connected(); assert.equal(h.connected(), true); assert.deepEqual(h.events, ["patient:data"]);
  h.events.length = 0; h.sources[0].handlers.connected(); h.sources[0].handlers.patient_data_change(); h.sources[0].onerror();
  assert.deepEqual(h.events, []); assert.equal(h.connected(), true);
  h.stop(); h.sources[1].handlers.patient_data_change(); assert.deepEqual(h.events, []); assert.equal(h.connected(), false);
});

test("a delayed stream token cannot reopen a signed-out or previous patient's stream", async () => {
  const pending = []; const h = harness(() => new Promise(resolve => pending.push(resolve)));
  h.start(); h.stop(); pending[0]({ token: "previous-patient" }); await flush();
  assert.equal(h.sources.length, 0); assert.equal(h.timers.size, 0);
  h.start(); h.stop(); h.start(); pending[1]({ token: "obsolete-patient" }); await flush();
  assert.equal(h.sources.length, 0);
  pending[2]({ token: "current-patient" }); await flush();
  assert.equal(h.sources.length, 1); assert.ok(h.sources[0].url.includes("current-patient")); h.stop();
});
