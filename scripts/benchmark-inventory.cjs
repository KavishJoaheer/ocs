// Repeatable, disposable inventory GET benchmark. Never touches the live DB.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocs-inventory-benchmark-"));
process.env.DB_PATH = path.join(tempDir, "benchmark.db");
process.env.NODE_ENV = "test";
process.env.API_RATE_LIMIT_PER_MINUTE = "5000";

const { createApp } = require("../server/src/app");
const { db } = require("../server/src/db");

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]);
}

async function main() {
  const app = createApp();
  const folderId = db.prepare("SELECT id FROM inventory_folders ORDER BY id LIMIT 1").get().id;
  const actorId = db.prepare("SELECT id FROM users WHERE username='operator01'").get().id;
  const items = [];
  db.transaction(() => {
    const itemInsert = db.prepare(`INSERT INTO inventory
      (item_name,folder_id,quantity,minimum_quantity,unit,cost_price,selling_price,stock_scope)
      VALUES (?,?,20,5,'unit',10,20,'ocs')`);
    const batchInsert = db.prepare(`INSERT INTO inventory_batches
      (item_id,quantity_remaining,expiry_date,unit_cost,is_non_expiring,supplier_name,received_date)
      VALUES (?,?,?,10,0,'Benchmark Supplier','2026-09-01')`);
    for (let i = 0; i < 500; i += 1) {
      const id = Number(itemInsert.run(`Benchmark supply ${i}`, folderId).lastInsertRowid);
      items.push(id);
      batchInsert.run(id, 12, "2028-06-01");
      batchInsert.run(id, 8, "2029-06-01");
    }
    const shipmentInsert = db.prepare(`INSERT INTO inventory_shipments
      (supplier,delivery_note,operation_id,status,total_rows,valid_rows,imported_by_user_id,received_date,released_at)
      VALUES ('Benchmark Supplier',?,?,?,3,3,?,'2026-09-01',?)`);
    const lineInsert = db.prepare(`INSERT INTO inventory_staging
      (folder_id,item_name,quantity,cost_price,selling_price,expiry_date,status,created_by_user_id,shipment_id)
      VALUES (?,'Benchmark supply',5,10,20,'2029-06-01',?,?,?)`);
    for (let i = 0; i < 130; i += 1) {
      const pending = i < 30;
      const shipmentId = Number(shipmentInsert.run(`BENCH-${i}`, `benchmark-${i}`, pending ? "pending" : "released", actorId, pending ? null : "2026-09-01 10:00:00").lastInsertRowid);
      for (let line = 0; line < 3; line += 1) {
        lineInsert.run(folderId, pending ? "pending" : "released", actorId, shipmentId);
      }
    }
  })();

  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const login = await fetch(`${base}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "operator01", password: "Welcome@123" }),
    });
    if (!login.ok) throw new Error(`Benchmark login failed: ${login.status}`);
    const token = (await login.json()).token;
    const results = [];
    for (const view of ["stock", "shipments", "count", "queues"]) {
      const samples = [];
      let bytes = 0;
      for (let i = 0; i < 7; i += 1) {
        const start = performance.now();
        const response = await fetch(`${base}/inventory?view=${view}`, { headers: { Authorization: `Bearer ${token}` } });
        const body = await response.text();
        if (!response.ok) throw new Error(`${view}: ${response.status} ${body.slice(0, 200)}`);
        if (i > 0) { samples.push(performance.now() - start); bytes += Buffer.byteLength(body); }
      }
      results.push({ view, p50_ms: percentile(samples, 0.5), p95_ms: percentile(samples, 0.95), mean_kb: Math.round(bytes / samples.length / 1024) });
    }
    process.stdout.write(`${JSON.stringify({ fixture: { products: 500, lots: 1000, pending_deliveries: 30, completed_deliveries: 100 }, results }, null, 2)}\n`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
