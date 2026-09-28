const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocs-sync-doctor-stock-"));
process.env.DB_PATH = path.join(tempDir, "test.db");
process.env.NODE_ENV = "test";

const { db, initializeDatabase } = require("../src/db");
const { syncDoctorStockFromOcsSync } = require("../src/scripts/syncDoctorStockFromOcs");

before(() => initializeDatabase());

after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("every doctor bag repeats the warehouse catalogue without copying warehouse quantity", () => {
  const folderId = db.prepare("SELECT id FROM inventory_folders WHERE name = 'Consumable' AND owner_doctor_id IS NULL LIMIT 1").get().id;
  const doctors = db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id").all();
  assert.ok(doctors.length >= 2);
  const [first, second] = doctors;

  const warehouseId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES ('Warehouse Catalogue Item', 'stock', ?, 'ocs', NULL, 12, 2, 'unit', 9, 40)
  `).run(folderId).lastInsertRowid);
  const serviceId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES ('Warehouse Catalogue Service', 'service', ?, 'ocs', NULL, 0, 0, 'service', 0, 500)
  `).run(folderId).lastInsertRowid);
  const keptBagId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES ('Warehouse Catalogue Item', 'stock', ?, 'doctor', ?, 3, 0, 'unit', 9, 0)
  `).run(folderId, first.id).lastInsertRowid);
  const extraBagId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES ('Bag Only Trial Item', 'stock', ?, 'doctor', ?, 0, 0, 'unit', 0, 0)
  `).run(folderId, first.id).lastInsertRowid);
  const stockedExtraId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES ('Bag Only Counted Item', 'stock', ?, 'doctor', ?, 4, 0, 'unit', 8, 0)
  `).run(folderId, second.id).lastInsertRowid);

  const summary = syncDoctorStockFromOcsSync({ skipInit: true, pruneExtras: true });
  assert.ok(summary.inserted >= doctors.length);
  assert.ok(summary.prune_blocked >= 1);

  const kept = db.prepare("SELECT quantity, selling_price FROM inventory WHERE id = ?").get(keptBagId);
  assert.equal(Number(kept.quantity), 3);
  assert.equal(Number(kept.selling_price), 40);
  const extra = db.prepare("SELECT archived_at FROM inventory WHERE id = ?").get(extraBagId);
  assert.ok(extra.archived_at);
  const stockedExtra = db.prepare("SELECT archived_at, quantity FROM inventory WHERE id = ?").get(stockedExtraId);
  assert.equal(stockedExtra.archived_at, null);
  assert.equal(Number(stockedExtra.quantity), 4);

  for (const doctor of doctors) {
    const item = db.prepare(`
      SELECT quantity, item_kind FROM inventory
      WHERE stock_scope = 'doctor' AND owner_doctor_id = ? AND item_name = 'Warehouse Catalogue Item' AND archived_at IS NULL
    `).get(doctor.id);
    const service = db.prepare(`
      SELECT quantity, item_kind, selling_price FROM inventory
      WHERE stock_scope = 'doctor' AND owner_doctor_id = ? AND item_name = 'Warehouse Catalogue Service' AND archived_at IS NULL
    `).get(doctor.id);
    assert.ok(item, `item missing for doctor ${doctor.id}`);
    assert.equal(item.item_kind, "stock");
    assert.ok(service, `service missing for doctor ${doctor.id}`);
    assert.equal(service.item_kind, "service");
    assert.equal(Number(service.quantity), 0);
    assert.equal(Number(service.selling_price), 500);
    if (Number(doctor.id) !== Number(first.id)) assert.equal(Number(item.quantity), 0);
  }

  const warehouse = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(warehouseId);
  assert.equal(Number(warehouse.quantity), 12);
  assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(serviceId).quantity), 0);
});
