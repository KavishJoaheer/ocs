const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocs-inventory-category-alignment-"));
process.env.DB_PATH = path.join(tempDir, "test.db");
process.env.NODE_ENV = "test";

const { db, initializeDatabase } = require("../src/db");
const { ocsConsumablesExtension } = require("../src/config/ocsConsumablesExtension");
const { ocsConsumablesPdfCatalog } = require("../src/config/ocsConsumablesPdfCatalog");
const { ocsIVDrugsPdfCatalog } = require("../src/config/ocsIVDrugsPdfCatalog");
const {
  alignInventoryCategories,
  RETIRED_OCS_CONSUMABLE_SKUS,
} = require("../src/lib/inventoryCategoryAlignment");

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
  "Urine bag",
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

test("N/S 100ml and renamed DNS are canonical IV Drug entries", () => {
  assert.equal(ocsConsumablesPdfCatalog.some((item) => item.name === "N/S 100ml"), false);
  for (const itemName of ["N/S 100ml", "DNS/Dextrose 50%"] ) {
    const row = ocsIVDrugsPdfCatalog.find((item) => item.name === itemName);
    assert.ok(row, itemName);
    assert.equal(row.category, "IV Drugs");
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

  const ivPreparedIds = [];
  for (const [itemName, expectedName] of [
    ["N/S 100ml", "N/S 100ml"],
    ["Sodium Chloride&Dextrose(500ml)", "DNS/Dextrose 50%"],
  ]) {
    for (const [scope, ownerDoctorId, quantity] of [
      ["ocs", null, 31],
      ["doctor", doctorIds[0], 7],
      ["doctor", doctorIds[1], 9],
    ]) {
      const existing = findRow.get(scope, ownerDoctorId || 0, itemName);
      const id = existing
        ? (updateRow.run(consumableId, quantity, existing.id), Number(existing.id))
        : Number(insertRow.run(itemName, consumableId, scope, ownerDoctorId, quantity).lastInsertRowid);
      ivPreparedIds.push({ id, quantity, expectedName });
    }
  }

  const first = alignInventoryCategories();
  assert.ok(first.updated >= TARGET_ITEMS.length * 3);
  const activeDoctorCount = Number(db.prepare("SELECT COUNT(*) AS count FROM doctors WHERE deleted_at IS NULL").get().count);
  assert.equal(first.inserted, (2 * (activeDoctorCount + 1)) + (activeDoctorCount + 1 - 3));
  assert.equal(first.renamed, 3);
  assert.equal(first.conflicts, 0);

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

  const ivRows = db.prepare(`
    SELECT i.id, i.item_name, i.quantity, i.cost_price, i.selling_price, f.name AS folder_name
    FROM inventory i
    LEFT JOIN inventory_folders f ON f.id = i.folder_id
    WHERE i.id IN (${ivPreparedIds.map(() => "?").join(",")})
  `).all(...ivPreparedIds.map((row) => row.id));
  assert.equal(ivRows.length, ivPreparedIds.length);
  for (const row of ivRows) {
    const original = ivPreparedIds.find((item) => item.id === Number(row.id));
    assert.equal(row.item_name, original.expectedName);
    assert.equal(row.folder_name, "IV Drugs");
    assert.equal(Number(row.quantity), original.quantity);
    assert.equal(Number(row.cost_price), 12.5);
    assert.equal(Number(row.selling_price), 25);
  }

  const retry = alignInventoryCategories();
  assert.equal(retry.updated, 0, "alignment must be idempotent");
  assert.equal(retry.inserted, 0);
  assert.equal(retry.renamed, 0);
  assert.equal(retry.conflicts, 0);
});

test("required O2 time-charge rows are created once for warehouse and every doctor", () => {
  const activeDoctorCount = Number(db.prepare("SELECT COUNT(*) AS count FROM doctors WHERE deleted_at IS NULL").get().count);
  for (const itemName of O2_ITEMS.slice(2)) {
    const rows = db.prepare(`
      SELECT i.stock_scope, i.owner_doctor_id, i.item_kind, i.quantity, i.minimum_quantity,
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
      assert.equal(row.item_kind, "service");
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

test("retired consumable SKUs are absent from the warehouse catalogues", () => {
  for (const itemName of RETIRED_OCS_CONSUMABLE_SKUS) {
    assert.equal(
      ocsConsumablesPdfCatalog.some((item) => item.name === itemName),
      false,
      itemName,
    );
    assert.equal(
      ocsConsumablesExtension.some((item) => item.name === itemName),
      false,
      itemName,
    );
  }
});

test("alignment never archives retired SKUs until on-hand, batches and reservations are zero", () => {
  const consumableId = db.prepare("SELECT id FROM inventory_folders WHERE name='Consumable' AND owner_doctor_id IS NULL LIMIT 1").get().id;
  const doctorIds = db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id LIMIT 2").all().map((row) => Number(row.id));
  assert.equal(doctorIds.length, 2);
  const insertRow = db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity,
      unit, cost_price, selling_price, updated_at
    ) VALUES (?, ?, ?, ?, 4, 2, 'unit', 0, 0, CURRENT_TIMESTAMP)
  `);

  const insertedIds = [];
  for (const itemName of RETIRED_OCS_CONSUMABLE_SKUS) {
    insertedIds.push(Number(insertRow.run(itemName, consumableId, "ocs", null).lastInsertRowid));
    for (const doctorId of doctorIds) {
      insertedIds.push(Number(insertRow.run(itemName, consumableId, "doctor", doctorId).lastInsertRowid));
    }
  }

  const expectedArchived = RETIRED_OCS_CONSUMABLE_SKUS.length * (1 + doctorIds.length);
  const first = alignInventoryCategories();
  assert.equal(first.archived, 0);
  for (const id of insertedIds) {
    assert.equal(db.prepare("SELECT archived_at FROM inventory WHERE id = ?").get(id).archived_at, null);
  }

  db.prepare(`UPDATE inventory SET quantity = 0 WHERE id IN (${insertedIds.map(() => "?").join(",")})`)
    .run(...insertedIds);
  const second = alignInventoryCategories();
  assert.ok(second.archived >= expectedArchived);

  for (const itemName of RETIRED_OCS_CONSUMABLE_SKUS) {
    const rows = db.prepare(`
      SELECT stock_scope, owner_doctor_id, archived_at
      FROM inventory
      WHERE LOWER(TRIM(item_name)) = LOWER(TRIM(?))
        AND (
          (stock_scope = 'ocs' AND owner_doctor_id IS NULL)
          OR (stock_scope = 'doctor' AND owner_doctor_id IS NOT NULL)
        )
    `).all(itemName);
    assert.equal(rows.length, 1 + doctorIds.length, itemName);
    for (const row of rows) {
      assert.ok(row.archived_at, `${itemName} ${row.stock_scope}`);
    }
  }

  const retry = alignInventoryCategories();
  assert.equal(retry.archived, 0, "retired SKU archive must be idempotent");
});
