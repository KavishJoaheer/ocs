const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocs-inventory-category-alignment-"));
process.env.DB_PATH = path.join(tempDir, "test.db");
process.env.NODE_ENV = "test";

const { db, initializeDatabase } = require("../src/db");
const { ocsConsumablesPdfCatalog } = require("../src/config/ocsConsumablesPdfCatalog");
const { alignInventoryCategories } = require("../src/lib/inventoryCategoryAlignment");

const TARGET_FOLDER = "Catherisation & NGT";
const TARGET_ITEMS = [
  "2 Way Foley Catheter (Ch/Fr 14)",
  "2 Way Foley Catheter (Ch/Fr 16)",
  "2 Way Foley Catheter (Ch/Fr 18)",
  "2 Way Foley Catheter (Ch/Fr 20)",
  "2 Way Foley Catheter (Ch/Fr 22)",
  "Irrigation Syringe (50ml)",
  "NGT (14fg x105cm)",
  "NGT (16fg x105cm)",
  "NGT (18fg x105cm)",
];
const O2_FOLDER = "O2 & Nebuliser";
const O2_ITEMS = [
  "Nebulizer Mask (Adult)",
  "Nebulizer Mask (Paediatric)",
  "O2 first 30mins",
  "O2 second 30 mins",
];

before(() => initializeDatabase());

after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("catheterisation and NGT catalogue metadata uses the dedicated folder", () => {
  for (const itemName of TARGET_ITEMS) {
    const row = ocsConsumablesPdfCatalog.find((item) => item.name === itemName);
    assert.ok(row, itemName);
    assert.equal(row.category, TARGET_FOLDER, itemName);
  }
});

test("oxygen and nebuliser catalogue metadata uses the dedicated folder", () => {
  for (const itemName of O2_ITEMS) {
    const row = ocsConsumablesPdfCatalog.find((item) => item.name === itemName);
    assert.ok(row, itemName);
    assert.equal(row.category, O2_FOLDER, itemName);
  }
});

test("category alignment moves warehouse and doctor rows without changing stock facts", () => {
  const consumableId = db.prepare("SELECT id FROM inventory_folders WHERE name='Consumable' AND owner_doctor_id IS NULL LIMIT 1").get().id;
  const doctorIds = db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id LIMIT 2").all().map((row) => Number(row.id));
  assert.equal(doctorIds.length, 2);

  const findRow = db.prepare(`
    SELECT id FROM inventory
    WHERE stock_scope = ? AND COALESCE(owner_doctor_id, 0) = ? AND LOWER(TRIM(item_name)) = LOWER(TRIM(?))
    LIMIT 1
  `);
  const insertRow = db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity,
      unit, cost_price, selling_price, updated_at
    ) VALUES (?, ?, ?, ?, ?, 4, 'unit', 12.5, 25, CURRENT_TIMESTAMP)
  `);
  const updateRow = db.prepare(`
    UPDATE inventory
    SET folder_id = ?, quantity = ?, cost_price = 12.5, selling_price = 25
    WHERE id = ?
  `);

  const preparedIds = [];
  for (const [itemIndex, itemName] of TARGET_ITEMS.entries()) {
    for (const [scope, ownerDoctorId, quantity] of [
      ["ocs", null, itemIndex + 10],
      ["doctor", doctorIds[0], itemIndex + 2],
      ["doctor", doctorIds[1], itemIndex + 3],
    ]) {
      const existing = findRow.get(scope, ownerDoctorId || 0, itemName);
      const id = existing
        ? (updateRow.run(consumableId, quantity, existing.id), Number(existing.id))
        : Number(insertRow.run(itemName, consumableId, scope, ownerDoctorId, quantity).lastInsertRowid);
      preparedIds.push({ id, quantity });
    }
  }

  const first = alignInventoryCategories();
  assert.ok(first.updated >= TARGET_ITEMS.length * 3);
  const activeDoctorCount = Number(db.prepare("SELECT COUNT(*) AS count FROM doctors WHERE deleted_at IS NULL").get().count);
  assert.equal(first.inserted, 2 * (activeDoctorCount + 1));

  const placeholders = preparedIds.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT i.id, i.quantity, i.cost_price, i.selling_price, f.name AS folder_name
    FROM inventory i
    LEFT JOIN inventory_folders f ON f.id = i.folder_id
    WHERE i.id IN (${placeholders})
  `).all(...preparedIds.map((row) => row.id));
  assert.equal(rows.length, preparedIds.length);
  for (const row of rows) {
    const original = preparedIds.find((item) => item.id === Number(row.id));
    assert.equal(row.folder_name, TARGET_FOLDER);
    assert.equal(Number(row.quantity), original.quantity);
    assert.equal(Number(row.cost_price), 12.5);
    assert.equal(Number(row.selling_price), 25);
  }

  assert.equal(alignInventoryCategories().updated, 0, "alignment must be idempotent");
});

test("required O2 time-charge rows are created once for warehouse and every doctor", () => {
  const activeDoctorCount = Number(db.prepare("SELECT COUNT(*) AS count FROM doctors WHERE deleted_at IS NULL").get().count);
  for (const itemName of O2_ITEMS.slice(2)) {
    const rows = db.prepare(`
      SELECT i.stock_scope, i.owner_doctor_id, i.quantity, i.minimum_quantity,
             i.unit, i.cost_price, i.selling_price, f.name AS folder_name
      FROM inventory i
      LEFT JOIN inventory_folders f ON f.id = i.folder_id
      WHERE LOWER(TRIM(i.item_name)) = LOWER(TRIM(?))
    `).all(itemName);
    assert.equal(rows.length, activeDoctorCount + 1, itemName);
    assert.equal(rows.filter((row) => row.stock_scope === "ocs").length, 1);
    assert.equal(rows.filter((row) => row.stock_scope === "doctor").length, activeDoctorCount);
    for (const row of rows) {
      assert.equal(row.folder_name, O2_FOLDER);
      assert.equal(Number(row.quantity), 0);
      assert.equal(Number(row.minimum_quantity), 0);
      assert.equal(row.unit, "30 min session");
      assert.equal(Number(row.cost_price), 0);
      assert.equal(Number(row.selling_price), 0);
    }
  }
  const retry = alignInventoryCategories();
  assert.equal(retry.inserted, 0);
  assert.equal(retry.updated, 0);
});
