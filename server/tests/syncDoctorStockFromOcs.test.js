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
    ) VALUES ('Warehouse Catalogue Item', 'stock', ?, 'doctor', ?, 3, 0, 'unit', 1, 2)
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
  assert.equal(summary.prune_blocked, 0);

  const kept = db.prepare("SELECT quantity, cost_price, selling_price FROM inventory WHERE id = ?").get(keptBagId);
  assert.equal(Number(kept.quantity), 3);
  assert.equal(Number(kept.cost_price), 9);
  assert.equal(Number(kept.selling_price), 40);
  const extra = db.prepare("SELECT archived_at FROM inventory WHERE id = ?").get(extraBagId);
  assert.ok(extra.archived_at);
  const stockedExtra = db.prepare("SELECT archived_at, quantity FROM inventory WHERE id = ?").get(stockedExtraId);
  assert.ok(stockedExtra.archived_at);
  assert.equal(Number(stockedExtra.quantity), 0);
  const writtenOff = db.prepare(`
    SELECT quantity, action_type FROM inventory_movements WHERE item_id = ? AND action_type = 'remove'
  `).get(stockedExtraId);
  assert.equal(Number(writtenOff.quantity), 4);

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

test("doctor bags take the warehouse name, folder, and service kind", () => {
  const folderId = (name) => {
    const existing = db.prepare(
      "SELECT id FROM inventory_folders WHERE name = ? AND owner_doctor_id IS NULL LIMIT 1",
    ).get(name);
    if (existing) return existing.id;
    return Number(db.prepare(
      "INSERT INTO inventory_folders (name, parent_id, owner_doctor_id, updated_at) VALUES (?, NULL, NULL, CURRENT_TIMESTAMP)",
    ).run(name).lastInsertRowid);
  };
  const consumableId = folderId("Consumable");
  const servicesId = folderId("Services");
  const ivId = folderId("IV Drugs");
  const doctorId = db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id LIMIT 1").get().id;
  const insert = db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 'unit', 0, 0)
  `);

  insert.run("Silver Sulphadiazine Tulle", "stock", consumableId, "ocs", null, 0);
  const tulleId = Number(insert.run("Silver Sulphadiazine tulle", "stock", servicesId, "doctor", doctorId, 6).lastInsertRowid);
  insert.run("Syringe (5ml)", "stock", consumableId, "ocs", null, 0);
  const oldSyringeId = Number(insert.run("Syringe 5ml", "stock", consumableId, "doctor", doctorId, 4).lastInsertRowid);
  const newSyringeId = Number(insert.run("Syringe (5ml)", "stock", consumableId, "doctor", doctorId, 2).lastInsertRowid);
  insert.run("IV N/S 500ml", "stock", ivId, "ocs", null, 0);
  const salineId = Number(insert.run("N/S 500ml", "stock", consumableId, "doctor", doctorId, 7).lastInsertRowid);
  insert.run("Alignment Test Service", "service", servicesId, "ocs", null, 0);
  const serviceBagId = Number(insert.run("Alignment Test Service", "stock", consumableId, "doctor", doctorId, 3).lastInsertRowid);

  syncDoctorStockFromOcsSync({ skipInit: true, pruneExtras: true });

  const tulle = db.prepare("SELECT item_name, folder_id, quantity FROM inventory WHERE id = ?").get(tulleId);
  assert.equal(tulle.item_name, "Silver Sulphadiazine Tulle");
  assert.equal(Number(tulle.folder_id), consumableId);
  assert.equal(Number(tulle.quantity), 6);

  const oldSyringe = db.prepare("SELECT archived_at, quantity FROM inventory WHERE id = ?").get(oldSyringeId);
  assert.ok(oldSyringe.archived_at);
  assert.equal(Number(oldSyringe.quantity), 0);
  const syringe = db.prepare("SELECT item_name, quantity, archived_at FROM inventory WHERE id = ?").get(newSyringeId);
  assert.equal(syringe.item_name, "Syringe (5ml)");
  assert.equal(syringe.archived_at, null);
  assert.equal(Number(syringe.quantity), 6);

  const saline = db.prepare("SELECT item_name, folder_id, quantity, archived_at FROM inventory WHERE id = ?").get(salineId);
  assert.equal(saline.archived_at, null);
  assert.equal(saline.item_name, "IV N/S 500ml");
  assert.equal(Number(saline.folder_id), ivId);
  assert.equal(Number(saline.quantity), 7);

  const service = db.prepare("SELECT item_kind, folder_id, quantity FROM inventory WHERE id = ?").get(serviceBagId);
  assert.equal(service.item_kind, "service");
  assert.equal(Number(service.folder_id), servicesId);
  assert.equal(Number(service.quantity), 0);
});
