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
  RETIRED_OCS_SERVICE_ITEMS,
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

test("nebulizer masks are no longer catalogue supplies", () => {
  for (const itemName of ["Nebulizer Mask (Adult)", "Nebulizer Mask (Paediatric)"]) {
    assert.equal(ocsConsumablesPdfCatalog.some((item) => item.name === itemName), false, itemName);
    assert.equal(RETIRED_OCS_CONSUMABLE_SKUS.includes(itemName), true, itemName);
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
  assert.equal(first.inserted, activeDoctorCount + 1 - 3);
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

function oxygenFolderId() {
  const existing = db.prepare("SELECT id FROM inventory_folders WHERE name = ? AND owner_doctor_id IS NULL LIMIT 1").get(O2_FOLDER);
  if (existing) return Number(existing.id);
  return Number(db.prepare("INSERT INTO inventory_folders (name, owner_doctor_id) VALUES (?, NULL)").run(O2_FOLDER).lastInsertRowid);
}

test("removed O2 time charges are retired in warehouse and doctor bags, including billing catalogue", () => {
  const folderId = oxygenFolderId();
  const doctorIds = db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id").all().map((row) => Number(row.id));
  const insert = db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES (?, 'service', ?, ?, ?, 0, 0, '30 min session', 300, 600)
  `);
  const ids = [];
  for (const name of RETIRED_OCS_SERVICE_ITEMS) {
    assert.equal(ocsConsumablesPdfCatalog.some((row) => row.name === name), false);
    assert.equal(ocsConsumablesExtension.some((row) => row.name === name), false);
    ids.push(Number(insert.run(name, folderId, "ocs", null).lastInsertRowid));
    for (const doctorId of doctorIds) {
      ids.push(Number(insert.run(name, folderId, "doctor", doctorId).lastInsertRowid));
    }
  }

  const result = alignInventoryCategories();
  assert.equal(result.archived, ids.length);
  assert.equal(result.written_off, 0);
  for (const id of ids) {
    const row = db.prepare("SELECT archived_at, selling_price FROM inventory WHERE id = ?").get(id);
    assert.ok(row.archived_at);
    assert.equal(Number(row.selling_price), 600);
  }
  const activeBillingRows = db.prepare(`
    SELECT COUNT(*) AS count FROM inventory
    WHERE stock_scope = 'doctor' AND archived_at IS NULL
      AND lower(trim(item_name)) IN ('o2 first 30mins', 'o2 second 30 mins')
  `).get();
  assert.equal(Number(activeBillingRows.count), 0);

  const retry = alignInventoryCategories();
  assert.equal(retry.inserted, 0);
  assert.equal(retry.archived, 0);
});

test("old oxygen stock charges leave the list and the billing service stays", () => {
  const folderId = oxygenFolderId();
  const insert = db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES (?, ?, ?, 'ocs', NULL, ?, 0, 'unit', 10, 0)
  `);
  const firstOxygenId = Number(insert.run("O2 with mask - first 30 min", "stock", folderId, 0).lastInsertRowid);
  const combinedId = Number(insert.run("O2 with mask - first 30 min + nebule Pulmicort / Dulopro, or Pulmicort + Dulopro", "stock", folderId, 0).lastInsertRowid);
  const extraId = Number(insert.run("Each additional 30 min of O2", "stock", folderId, 0).lastInsertRowid);
  const serviceId = Number(insert.run("Each additional 30 mins O2", "service", folderId, 0).lastInsertRowid);

  const result = alignInventoryCategories();
  assert.ok(result.archived >= 3);
  for (const id of [firstOxygenId, combinedId, extraId]) {
    const row = db.prepare("SELECT archived_at, quantity FROM inventory WHERE id = ?").get(id);
    assert.ok(row.archived_at, String(id));
    assert.equal(Number(row.quantity), 0);
  }
  const service = db.prepare("SELECT archived_at, item_kind FROM inventory WHERE id = ?").get(serviceId);
  assert.equal(service.archived_at, null);
  assert.equal(service.item_kind, "service");
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

test("alignment writes off leftover retired SKUs then archives them", () => {
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
  assert.ok(first.archived >= expectedArchived);
  assert.equal(first.blocked, 0);
  assert.ok(first.written_off >= expectedArchived);
  for (const id of insertedIds) {
    const row = db.prepare("SELECT archived_at, quantity FROM inventory WHERE id = ?").get(id);
    assert.ok(row.archived_at);
    assert.equal(Number(row.quantity || 0), 0);
  }
  assert.ok(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM inventory_audit_logs
      WHERE action_type = 'retired_sku_write_off'
    `).get().count >= expectedArchived,
  );

  for (const itemName of RETIRED_OCS_CONSUMABLE_SKUS) {
    const rows = db.prepare(`
      SELECT stock_scope, owner_doctor_id, archived_at, quantity
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
      assert.equal(Number(row.quantity || 0), 0, itemName);
    }
  }

  const retry = alignInventoryCategories();
  assert.equal(retry.archived, 0, "retired SKU archive must be idempotent");
  assert.equal(retry.blocked, 0);
  assert.equal(retry.written_off, 0);
});
