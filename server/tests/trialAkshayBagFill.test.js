const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocs-trial-akshay-bag-"));
process.env.DB_PATH = path.join(tempDir, "test.db");
process.env.NODE_ENV = "test";

const { db, initializeDatabase } = require("../src/db");
const { applyTrialAkshayBagFill } = require("../src/lib/trialAkshayBagFill");

before(() => initializeDatabase());

after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("the trial fill adds 20 to each stock item in Dr Akshay's bag once", () => {
  const folderId = db.prepare("SELECT id FROM inventory_folders WHERE owner_doctor_id IS NULL ORDER BY id LIMIT 1").get().id;
  const akshayId = Number(db.prepare(`
    INSERT INTO doctors (full_name, specialization, is_active)
    VALUES ('Akshay Jeetah', 'General practice', 1)
  `).run().lastInsertRowid);
  const otherId = Number(db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL AND id != ? ORDER BY id LIMIT 1").get(akshayId).id);

  function addItem(name, kind, doctorId, quantity) {
    return Number(db.prepare(`
      INSERT INTO inventory (
        item_name, item_kind, folder_id, stock_scope, owner_doctor_id,
        quantity, minimum_quantity, unit, cost_price, selling_price
      ) VALUES (?, ?, ?, 'doctor', ?, ?, 0, 'unit', 5, 0)
    `).run(name, kind, folderId, doctorId, quantity).lastInsertRowid);
  }

  const countedId = addItem("Trial counted item", "stock", akshayId, 1);
  const emptyId = addItem("Trial empty item", "stock", akshayId, 0);
  const serviceId = addItem("Trial service", "service", akshayId, 0);
  const otherIdItem = addItem("Trial counted item", "stock", otherId, 7);

  const first = applyTrialAkshayBagFill(db);
  assert.equal(first.applied, true);
  assert.equal(first.items, 2);
  assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(countedId).quantity), 21);
  assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(emptyId).quantity), 20);
  assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(serviceId).quantity), 0);
  assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(otherIdItem).quantity), 7);
  assert.equal(Number(db.prepare("SELECT SUM(quantity_remaining) AS qty FROM inventory_batches WHERE item_id = ?").get(emptyId).qty), 20);

  const second = applyTrialAkshayBagFill(db);
  assert.equal(second.applied, false);
  assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(emptyId).quantity), 20);
});
