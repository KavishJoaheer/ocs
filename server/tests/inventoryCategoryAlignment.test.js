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
const { ocsPediatricDrugsPdfCatalog } = require("../src/config/ocsPediatricDrugsPdfCatalog");
const { ocsOralDrugsPdfCatalog } = require("../src/config/ocsOralDrugsPdfCatalog");
const {
  alignInventoryCategories,
  RETIRED_OCS_CONSUMABLE_SKUS,
  RETIRED_OCS_IV_COMBINATION_SKUS,
  RETIRED_OCS_DISCONTINUED_DRUG_SKUS,
  RETIRED_OCS_GO_LIVE_SKUS,
  RETIRED_OCS_SERVICE_ITEMS,
  RETIRED_OCS_WAREHOUSE_ONLY_SKUS,
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

test("N/S 100ml remains an IV Drug and DNS is retired", () => {
  assert.equal(ocsConsumablesPdfCatalog.some((item) => item.name === "N/S 100ml"), false);
  const row = ocsIVDrugsPdfCatalog.find((item) => item.name === "N/S 100ml");
  assert.ok(row);
  assert.equal(row.category, "IV Drugs");
  assert.equal(ocsIVDrugsPdfCatalog.some((item) => item.name === "DNS/Dextrose 50%"), false);
  assert.equal(RETIRED_OCS_GO_LIVE_SKUS.includes("DNS/Dextrose 50%"), true);
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
  for (const [itemName, expectedName] of [["N/S 100ml", "N/S 100ml"]]) {
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

  const lasilixPreparedIds = [];
  for (const [scope, ownerDoctorId, quantity] of [
    ["ocs", null, 11],
    ["doctor", doctorIds[0], 3],
    ["doctor", doctorIds[1], 4],
  ]) {
    lasilixPreparedIds.push(Number(
      insertRow.run("Lasilix 20mg (IM/IV)", consumableId, scope, ownerDoctorId, quantity).lastInsertRowid,
    ));
  }

  const first = alignInventoryCategories();
  assert.ok(first.updated >= TARGET_ITEMS.length * 3);
  const activeDoctorCount = Number(db.prepare("SELECT COUNT(*) AS count FROM doctors WHERE deleted_at IS NULL").get().count);
  assert.equal(first.inserted, 7 * (activeDoctorCount + 1));
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


  for (const id of lasilixPreparedIds) {
    const row = db.prepare("SELECT item_name, quantity, cost_price, selling_price FROM inventory WHERE id = ?").get(id);
    assert.equal(row.item_name, "IM Lasilix 20mg");
    assert.equal(Number(row.cost_price), 12.5);
    assert.equal(Number(row.selling_price), 25);
  }

  const expectedServices = [
    ["IM Ceftriaxone 1g + lidocaine", 1200],
    ["IV Solu-cortef 100MG (Hisone) (including cannulation)", 2000],
    ["Each next N/S 500ml", 500],
    ["IV Lasilix 20mg", 800],
  ];
  for (const [itemName, sellingPrice] of expectedServices) {
    const serviceRows = db.prepare(`
      SELECT i.item_kind, i.quantity, i.minimum_quantity, i.unit, i.attributes, i.moa_notes,
        i.cost_price, i.selling_price, i.expiry_date, f.name AS folder_name
      FROM inventory i
      LEFT JOIN inventory_folders f ON f.id = i.folder_id
      WHERE lower(trim(i.item_name)) = lower(trim(?)) AND i.archived_at IS NULL
    `).all(itemName);
    assert.equal(serviceRows.length, activeDoctorCount + 1, itemName);
    for (const service of serviceRows) {
      assert.equal(service.item_kind, "service", itemName);
      assert.equal(service.folder_name, "Services", itemName);
      assert.equal(service.unit, "service", itemName);
      assert.equal(service.attributes, "", itemName);
      assert.equal(service.moa_notes, "", itemName);
      assert.equal(Number(service.quantity), 0, itemName);
      assert.equal(Number(service.minimum_quantity), 0, itemName);
      assert.equal(Number(service.cost_price), 0, itemName);
      assert.equal(Number(service.selling_price), sellingPrice, itemName);
      assert.equal(service.expiry_date, null, itemName);
    }
  }

  db.prepare(`
    UPDATE inventory
    SET quantity = 9,
        minimum_quantity = 8,
        unit = 'session',
        cost_price = 75,
        expiry_date = '2030-01-01',
        attributes = 'Legacy service attribute',
        moa_notes = 'Legacy administration note'
    WHERE item_kind = 'service' AND archived_at IS NULL
  `).run();
  const normalized = alignInventoryCategories();
  assert.ok(normalized.updated >= activeDoctorCount + 1);
  const normalizedServices = db.prepare(`
    SELECT quantity, minimum_quantity, unit, cost_price, expiry_date, attributes, moa_notes
    FROM inventory
    WHERE item_kind = 'service' AND archived_at IS NULL
  `).all();
  assert.ok(normalizedServices.length >= activeDoctorCount + 1);
  for (const service of normalizedServices) {
    assert.equal(Number(service.quantity), 0);
    assert.equal(Number(service.minimum_quantity), 0);
    assert.equal(service.unit, "service");
    assert.equal(Number(service.cost_price), 0);
    assert.equal(service.expiry_date, null);
    assert.equal(service.attributes, "");
    assert.equal(service.moa_notes, "");
  }

  const retry = alignInventoryCategories();
  assert.equal(retry.updated, 0, "alignment must be idempotent");
  assert.equal(retry.inserted, 0);
  assert.equal(retry.renamed, 0);
  assert.equal(retry.conflicts, 0);
});

test("Catheter Change is normalized as a cost-free service while preserving its selling price", () => {
  const consumableId = db.prepare("SELECT id FROM inventory_folders WHERE name='Consumable' AND owner_doctor_id IS NULL LIMIT 1").get().id;
  const doctorId = Number(db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id LIMIT 1").get().id);
  const insert = db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price, expiry_date
    ) VALUES ('Catheter Change', 'stock', ?, ?, ?, 6, 2, 'unit', 125, 2000, '2030-12-31')
  `);
  const ids = [
    Number(insert.run(consumableId, "ocs", null).lastInsertRowid),
    Number(insert.run(consumableId, "doctor", doctorId).lastInsertRowid),
  ];

  alignInventoryCategories();

  for (const id of ids) {
    const row = db.prepare(`
      SELECT i.item_kind, i.quantity, i.minimum_quantity, i.unit, i.cost_price,
        i.selling_price, i.expiry_date, f.name AS folder_name
      FROM inventory i
      JOIN inventory_folders f ON f.id = i.folder_id
      WHERE i.id = ?
    `).get(id);
    assert.equal(row.folder_name, "Services");
    assert.equal(row.item_kind, "service");
    assert.equal(row.quantity, 0);
    assert.equal(row.minimum_quantity, 0);
    assert.equal(row.unit, "service");
    assert.equal(row.cost_price, 0);
    assert.equal(row.selling_price, 2000);
    assert.equal(row.expiry_date, null);
  }
});

test("go-live removals leave the warehouse and every doctor bag", () => {
  const folderId = db.prepare("SELECT id FROM inventory_folders WHERE name='Consumable' AND owner_doctor_id IS NULL LIMIT 1").get().id;
  const doctorIds = db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id").all().map((row) => Number(row.id));
  const insert = db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES (?, ?, ?, ?, 0, 0, 'unit', 0, 0)
  `);
  const ids = [];
  for (const itemName of RETIRED_OCS_GO_LIVE_SKUS) {
    ids.push(Number(insert.run(itemName, folderId, "ocs", null).lastInsertRowid));
    for (const doctorId of doctorIds) {
      ids.push(Number(insert.run(itemName, folderId, "doctor", doctorId).lastInsertRowid));
    }
  }

  const result = alignInventoryCategories();
  assert.equal(result.archived, ids.length);
  assert.equal(result.blocked, 0);
  assert.equal(result.written_off, 0);

  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT archived_at FROM inventory WHERE id IN (${placeholders})
  `).all(...ids);
  assert.equal(rows.length, ids.length);
  assert.equal(rows.every((row) => Boolean(row.archived_at)), true);

  const active = db.prepare(`
    SELECT COUNT(*) AS count FROM inventory
    WHERE archived_at IS NULL
      AND lower(trim(item_name)) IN (${RETIRED_OCS_GO_LIVE_SKUS.map(() => "lower(trim(?))").join(",")})
  `).get(...RETIRED_OCS_GO_LIVE_SKUS);
  assert.equal(Number(active.count), 0);
});

test("retiring BIB Roll preserves an open stock count and its other lines", () => {
  const folderId = db.prepare("SELECT id FROM inventory_folders WHERE name='Consumable' AND owner_doctor_id IS NULL LIMIT 1").get().id;
  const bibId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES ('BIB Roll', ?, 'ocs', NULL, 1, 10, 'roll', 5, 0)
  `).run(folderId).lastInsertRowid);
  const keptId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES ('Counted item kept active', ?, 'ocs', NULL, 4, 0, 'unit', 2, 0)
  `).run(folderId).lastInsertRowid);
  const sessionId = Number(db.prepare(`
    INSERT INTO inventory_stocktake_sessions (scope, folder_id, status, notes, started_at)
    VALUES ('ocs', ?, 'in_progress', '', CURRENT_TIMESTAMP)
  `).run(folderId).lastInsertRowid);
  const insertLine = db.prepare(`
    INSERT INTO inventory_stocktake_session_items (
      session_id, inventory_id, system_quantity, physical_quantity, variance,
      expected_row_version, expected_quantity, left_unchanged
    ) VALUES (?, ?, ?, ?, ?, 1, ?, 0)
  `);
  const bibLineId = Number(insertLine.run(sessionId, bibId, 0, 1, 1, 0).lastInsertRowid);
  const keptLineId = Number(insertLine.run(sessionId, keptId, 0, 4, 4, 0).lastInsertRowid);

  const result = alignInventoryCategories();
  assert.ok(result.archived >= 1);
  assert.ok(result.written_off >= 1);

  const bib = db.prepare("SELECT quantity, archived_at FROM inventory WHERE id = ?").get(bibId);
  assert.equal(Number(bib.quantity), 0);
  assert.ok(bib.archived_at);
  const bibLine = db.prepare(`
    SELECT physical_quantity, variance, left_unchanged, reason
    FROM inventory_stocktake_session_items WHERE id = ?
  `).get(bibLineId);
  assert.equal(bibLine.physical_quantity, null);
  assert.equal(Number(bibLine.variance), 0);
  assert.equal(Number(bibLine.left_unchanged), 1);
  assert.match(bibLine.reason, /retired from the catalogue/i);

  const keptLine = db.prepare(`
    SELECT physical_quantity, variance, left_unchanged
    FROM inventory_stocktake_session_items WHERE id = ?
  `).get(keptLineId);
  assert.equal(Number(keptLine.physical_quantity), 4);
  assert.equal(Number(keptLine.variance), 4);
  assert.equal(Number(keptLine.left_unchanged), 0);
  assert.equal(db.prepare("SELECT status FROM inventory_stocktake_sessions WHERE id = ?").get(sessionId).status, "in_progress");
});

test("newly discontinued injections are retired from warehouse and doctor bags with an audit trail", () => {
  const discontinuedNames = [
    "IM Neurorubin forte-twice weekly for one month",
    "Lasilix (IM/IV) - Each next 20mg",
    "IM Tribeforte",
  ];
  const folderId = db.prepare("SELECT id FROM inventory_folders WHERE name='IM Drugs' AND owner_doctor_id IS NULL LIMIT 1").get().id;
  const doctorIds = db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id LIMIT 2").all().map((row) => Number(row.id));
  assert.equal(doctorIds.length, 2);
  const insert = db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES (?, ?, ?, ?, 1, 0, 'injection', 100, 500)
  `);
  const insertBatch = db.prepare(`
    INSERT INTO inventory_batches (
      item_id, quantity_remaining, unit_cost, expiry_date, received_date
    ) VALUES (?, 1, 100, '2026-12-30', '2026-10-01')
  `);
  const ids = [];
  for (const itemName of discontinuedNames) {
    const warehouseId = Number(insert.run(itemName, folderId, "ocs", null).lastInsertRowid);
    insertBatch.run(warehouseId);
    ids.push(warehouseId);
    for (const doctorId of doctorIds) {
      const bagId = Number(insert.run(itemName, folderId, "doctor", doctorId).lastInsertRowid);
      insertBatch.run(bagId);
      ids.push(bagId);
    }
  }

  const result = alignInventoryCategories();
  assert.ok(result.archived >= ids.length);
  assert.ok(result.written_off >= ids.length);
  for (const id of ids) {
    const row = db.prepare("SELECT quantity, archived_at FROM inventory WHERE id = ?").get(id);
    assert.equal(Number(row.quantity), 0);
    assert.ok(row.archived_at);
    assert.equal(
      Number(db.prepare("SELECT COALESCE(SUM(quantity_remaining), 0) AS quantity FROM inventory_batches WHERE item_id = ?").get(id).quantity),
      0,
    );
    assert.equal(
      Number(db.prepare("SELECT COUNT(*) AS count FROM inventory_audit_logs WHERE item_id = ? AND action_type = 'retired_sku_write_off'").get(id).count),
      1,
    );
  }
});

test("IM Largactil is retired from every stock location without erasing history or similar injections", () => {
  const folderId = db.prepare("SELECT id FROM inventory_folders WHERE name='IM Drugs' AND owner_doctor_id IS NULL LIMIT 1").get().id;
  const doctorIds = db.prepare("SELECT id FROM doctors ORDER BY id").all().map(row => Number(row.id));
  assert.ok(doctorIds.length > 1);
  const insert = db.prepare(`
    INSERT INTO inventory (item_name, folder_id, stock_scope, owner_doctor_id, quantity, unit, cost_price)
    VALUES (?, ?, ?, ?, 2, 'injection', 100)
  `);
  const ids = [Number(insert.run("IM Largactil", folderId, "ocs", null).lastInsertRowid)];
  for (const doctorId of doctorIds) {
    ids.push(Number(insert.run(" im largactil ", folderId, "doctor", doctorId).lastInsertRowid));
  }
  const keptId = Number(insert.run("IM Haloperidol", folderId, "ocs", null).lastInsertRowid);
  const kept = db.prepare("SELECT * FROM inventory WHERE id=?").get(keptId);
  const historyIds = [];
  for (const id of ids) {
    db.prepare(`INSERT INTO inventory_batches (item_id, quantity_remaining, unit_cost, expiry_date, received_date)
      VALUES (?, 2, 100, '2030-12-30', '2026-10-01')`).run(id);
    historyIds.push(Number(db.prepare(`
      INSERT INTO inventory_movements (item_id, movement_type, quantity, previous_quantity, next_quantity, note)
      VALUES (?, 'out', 1, 3, 2, 'Previous medication usage')
    `).run(id).lastInsertRowid));
  }
  const oldHistory = historyIds.map(id => db.prepare("SELECT * FROM inventory_movements WHERE id=?").get(id));

  alignInventoryCategories();
  for (const id of ids) {
    const row = db.prepare("SELECT quantity, archived_at FROM inventory WHERE id=?").get(id);
    assert.equal(Number(row.quantity), 0);
    assert.ok(row.archived_at);
    assert.equal(db.prepare("SELECT SUM(quantity_remaining) AS remaining FROM inventory_batches WHERE item_id=?").get(id).remaining, 0);
    const movement = db.prepare("SELECT * FROM inventory_movements WHERE item_id=? AND reference_type='catalogue_retirement'").get(id);
    assert.equal(movement.quantity, 2);
    assert.equal(JSON.parse(movement.meta_json).reason, "Discontinued");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_audit_logs WHERE item_id=? AND action_type='retired_sku_write_off'").get(id).count, 1);
  }
  assert.deepEqual(historyIds.map(id => db.prepare("SELECT * FROM inventory_movements WHERE id=?").get(id)), oldHistory);
  assert.deepEqual(db.prepare("SELECT * FROM inventory WHERE id=?").get(keptId), kept);
  const { isOcsCatalogExcluded } = require("../src/lib/ocsCatalogExclusions");
  assert.equal(isOcsCatalogExcluded("IM Largactil"), true);
  const retry = alignInventoryCategories();
  assert.equal(retry.archived, 0);
  assert.equal(retry.written_off, 0);
  for (const id of ids) {
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE item_id=? AND reference_type='catalogue_retirement'").get(id).count, 1);
  }
});

test("unused suction, strapping, and Neurorubin items are written off and retired everywhere", () => {
  const retiredNames = [
    "Suction Tube for suction machine",
    "Strapping",
    "Neurorubin forte-4 doses",
  ];
  for (const itemName of retiredNames) {
    assert.equal(RETIRED_OCS_GO_LIVE_SKUS.includes(itemName), true, itemName);
  }

  const folderId = db.prepare("SELECT id FROM inventory_folders WHERE name='Consumable' AND owner_doctor_id IS NULL LIMIT 1").get().id;
  const doctorIds = db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id LIMIT 2").all().map((row) => Number(row.id));
  assert.equal(doctorIds.length, 2);
  const insert = db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES (?, ?, ?, ?, 1, 0, 'unit', 100, 500)
  `);
  const insertBatch = db.prepare(`
    INSERT INTO inventory_batches (
      item_id, quantity_remaining, unit_cost, expiry_date, received_date
    ) VALUES (?, 1, 100, '2026-12-30', '2026-10-01')
  `);
  const ids = [];
  for (const itemName of retiredNames) {
    const warehouseId = Number(insert.run(itemName, folderId, "ocs", null).lastInsertRowid);
    insertBatch.run(warehouseId);
    ids.push(warehouseId);
    for (const doctorId of doctorIds) {
      const bagId = Number(insert.run(itemName, folderId, "doctor", doctorId).lastInsertRowid);
      insertBatch.run(bagId);
      ids.push(bagId);
    }
  }

  const result = alignInventoryCategories();
  assert.ok(result.archived >= ids.length);
  assert.ok(result.written_off >= ids.length);
  assert.equal(result.blocked, 0);
  for (const id of ids) {
    const row = db.prepare("SELECT quantity, archived_at FROM inventory WHERE id = ?").get(id);
    assert.equal(Number(row.quantity), 0);
    assert.ok(row.archived_at);
    assert.equal(
      Number(db.prepare("SELECT COALESCE(SUM(quantity_remaining), 0) AS quantity FROM inventory_batches WHERE item_id = ?").get(id).quantity),
      0,
    );
    assert.equal(
      Number(db.prepare("SELECT COUNT(*) AS count FROM inventory_audit_logs WHERE item_id = ? AND action_type = 'retired_sku_write_off'").get(id).count),
      1,
    );
  }
});

function oxygenFolderId() {
  const existing = db.prepare("SELECT id FROM inventory_folders WHERE name = ? AND owner_doctor_id IS NULL LIMIT 1").get(O2_FOLDER);
  if (existing) return Number(existing.id);
  return Number(db.prepare("INSERT INTO inventory_folders (name, owner_doctor_id) VALUES (?, NULL)").run(O2_FOLDER).lastInsertRowid);
}

test("removed O2 time charges are retired in warehouse and doctor bags, including billing catalogue", () => {
  const removedOxygenNames = ["O2 first 30mins", "O2 second 30 mins"];
  const folderId = oxygenFolderId();
  const doctorIds = db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id").all().map((row) => Number(row.id));
  const insert = db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES (?, 'service', ?, ?, ?, 0, 0, '30 min session', 300, 600)
  `);
  const ids = [];
  for (const name of removedOxygenNames) {
    assert.equal(RETIRED_OCS_SERVICE_ITEMS.includes(name), true);
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

test("named catheter services are written off and retired without touching similar items", () => {
  const retiredNames = [
    "Catheter Change (silicon)",
    "Catheterisation + Urine bag + wash out",
  ];
  for (const name of retiredNames) {
    assert.equal(RETIRED_OCS_SERVICE_ITEMS.includes(name), true, name);
  }

  const folderId = db.prepare("SELECT id FROM inventory_folders WHERE name='Consumable' AND owner_doctor_id IS NULL LIMIT 1").get().id;
  const doctorIds = db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id").all().map((row) => Number(row.id));
  const insert = db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES (?, 'stock', ?, ?, ?, 1, 0, 'unit', 100, 500)
  `);
  const insertBatch = db.prepare(`
    INSERT INTO inventory_batches (
      item_id, quantity_remaining, unit_cost, expiry_date, received_date
    ) VALUES (?, 1, 100, '2026-12-30', '2026-10-01')
  `);
  const ids = [];
  for (const name of retiredNames) {
    const warehouseId = Number(insert.run(name, folderId, "ocs", null).lastInsertRowid);
    insertBatch.run(warehouseId);
    ids.push(warehouseId);
    for (const doctorId of doctorIds) {
      const bagId = Number(insert.run(name, folderId, "doctor", doctorId).lastInsertRowid);
      insertBatch.run(bagId);
      ids.push(bagId);
    }
  }
  const similarItemId = Number(insert.run("Catheter Change (silicone)", folderId, "ocs", null).lastInsertRowid);

  const result = alignInventoryCategories();
  assert.equal(result.archived, ids.length);
  assert.equal(result.written_off, ids.length);
  assert.equal(result.blocked, 0);
  for (const id of ids) {
    const row = db.prepare("SELECT quantity, archived_at FROM inventory WHERE id = ?").get(id);
    assert.equal(Number(row.quantity), 0);
    assert.ok(row.archived_at, String(id));
    assert.equal(
      Number(db.prepare("SELECT COALESCE(SUM(quantity_remaining), 0) AS quantity FROM inventory_batches WHERE item_id = ?").get(id).quantity),
      0,
    );
    assert.equal(
      Number(db.prepare("SELECT COUNT(*) AS count FROM inventory_audit_logs WHERE item_id = ? AND action_type = 'retired_sku_write_off'").get(id).count),
      1,
    );
  }

  const similarItem = db.prepare("SELECT quantity, archived_at FROM inventory WHERE id = ?").get(similarItemId);
  assert.equal(Number(similarItem.quantity), 1);
  assert.equal(similarItem.archived_at, null);
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

test("adult and paediatric atomic enemas keep the counted quantity of the old sizes", () => {
  assert.equal(ocsConsumablesPdfCatalog.some((item) => item.name === "Atomic enema (Adult)"), true);
  assert.equal(ocsConsumablesPdfCatalog.some((item) => item.name === "Atomic enema (Paediatric)"), true);
  assert.equal(ocsConsumablesPdfCatalog.some((item) => item.name === "Staple remover"), true);
  const consumableId = db.prepare("SELECT id FROM inventory_folders WHERE name = 'Consumable' AND owner_doctor_id IS NULL LIMIT 1").get().id;
  const adultId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity,
      unit, cost_price, selling_price, updated_at
    ) VALUES ('Atomic Enema 20ml box of 2', ?, 'ocs', NULL, 6, 0, 'enema', 40, 0, CURRENT_TIMESTAMP)
  `).run(consumableId).lastInsertRowid);
  const paediatricId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity,
      unit, cost_price, selling_price, updated_at
    ) VALUES ('Atomic enema 10ml box of 2', ?, 'ocs', NULL, 4, 0, 'enema', 30, 0, CURRENT_TIMESTAMP)
  `).run(consumableId).lastInsertRowid);

  const aligned = alignInventoryCategories();
  assert.ok(aligned.renamed >= 2);
  const adult = db.prepare("SELECT item_name, quantity, cost_price FROM inventory WHERE id = ?").get(adultId);
  const paediatric = db.prepare("SELECT item_name, quantity, cost_price FROM inventory WHERE id = ?").get(paediatricId);
  assert.equal(adult.item_name, "Atomic enema (Adult)");
  assert.equal(Number(adult.quantity), 6);
  assert.equal(Number(adult.cost_price), 40);
  assert.equal(paediatric.item_name, "Atomic enema (Paediatric)");
  assert.equal(Number(paediatric.quantity), 4);
  assert.equal(Number(paediatric.cost_price), 30);
});

test("IV N/S combination stock charges leave the list", () => {
  for (const itemName of RETIRED_OCS_IV_COMBINATION_SKUS) {
    assert.equal(ocsIVDrugsPdfCatalog.some((item) => item.name === itemName), false, itemName);
  }
  assert.equal(ocsIVDrugsPdfCatalog.some((item) => item.name === "IV Perfalgan 1g (Paracetamol)"), true);

  const folderId = db.prepare("SELECT id FROM inventory_folders WHERE name = 'IV Drugs' AND owner_doctor_id IS NULL LIMIT 1").get()?.id
    || Number(db.prepare("INSERT INTO inventory_folders (name) VALUES ('IV Drugs')").run().lastInsertRowid);
  const insert = db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES (?, 'stock', ?, 'ocs', NULL, 0, 0, 'unit', 0, 0)
  `);
  const ids = RETIRED_OCS_IV_COMBINATION_SKUS.map((name) => Number(insert.run(name, folderId).lastInsertRowid));
  let keptRow = db.prepare(`
    SELECT id, archived_at FROM inventory
    WHERE stock_scope = 'ocs' AND owner_doctor_id IS NULL
      AND lower(trim(item_name)) = lower(trim('IV Perfalgan 1g (Paracetamol)'))
    ORDER BY id ASC LIMIT 1
  `).get();
  if (!keptRow) {
    keptRow = { id: Number(insert.run("IV Perfalgan 1g (Paracetamol)", folderId).lastInsertRowid), archived_at: null };
  }

  const result = alignInventoryCategories();
  assert.ok(result.archived >= ids.length);
  for (const id of ids) {
    const row = db.prepare("SELECT archived_at, quantity FROM inventory WHERE id = ?").get(id);
    assert.ok(row.archived_at, String(id));
    assert.equal(Number(row.quantity), 0);
  }
  const kept = db.prepare("SELECT archived_at FROM inventory WHERE id = ?").get(keptRow.id);
  assert.equal(kept.archived_at, null);
});

test("discontinued drug stock leaves warehouse and doctor bags", () => {
  const folderId = db.prepare("SELECT id FROM inventory_folders WHERE name = 'IM Drugs' AND owner_doctor_id IS NULL LIMIT 1").get()?.id
    || Number(db.prepare("INSERT INTO inventory_folders (name) VALUES ('IM Drugs')").run().lastInsertRowid);
  const doctorId = Number(db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id LIMIT 1").get().id);
  const insert = db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES (?, 'stock', ?, ?, ?, ?, 0, 'unit', 10, 0)
  `);
  const warehouseIds = RETIRED_OCS_DISCONTINUED_DRUG_SKUS.map((name) => {
    const qty = name === "Dextrose inj 50% 50ml" || name === "IV Ocid 40mg" ? 3 : 0;
    return Number(insert.run(name, folderId, "ocs", null, qty).lastInsertRowid);
  });
  const bagIds = RETIRED_OCS_DISCONTINUED_DRUG_SKUS.map((name) => (
    Number(insert.run(name, folderId, "doctor", doctorId, 0).lastInsertRowid)
  ));

  const result = alignInventoryCategories();
  assert.ok(result.archived >= warehouseIds.length + bagIds.length);
  assert.ok(result.written_off >= 1);
  for (const id of [...warehouseIds, ...bagIds]) {
    const row = db.prepare("SELECT archived_at, quantity FROM inventory WHERE id = ?").get(id);
    assert.ok(row.archived_at, String(id));
    assert.equal(Number(row.quantity), 0);
  }
});

test("named syrups and IV lasilix leave the warehouse and stay in doctor bags", () => {
  assert.equal(ocsPediatricDrugsPdfCatalog.some((item) => item.name === "Celestene 0.05%"), false);
  const folderId = db.prepare("SELECT id FROM inventory_folders WHERE name = 'Pediatric Drugs' AND owner_doctor_id IS NULL LIMIT 1").get()?.id
    || Number(db.prepare("INSERT INTO inventory_folders (name) VALUES ('Pediatric Drugs')").run().lastInsertRowid);
  const doctorId = Number(db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id LIMIT 1").get().id);
  const insert = db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES (?, 'stock', ?, ?, ?, ?, 0, 'unit', 10, 0)
  `);
  const warehouseIds = RETIRED_OCS_WAREHOUSE_ONLY_SKUS.map((name) => {
    const qty = name === "IV Lasilix - first 20mg" ? 38 : 0;
    return Number(insert.run(name, folderId, "ocs", null, qty).lastInsertRowid);
  });
  const bagId = Number(insert.run("Otrivine", folderId, "doctor", doctorId, 2).lastInsertRowid);

  const result = alignInventoryCategories();
  assert.ok(result.archived >= warehouseIds.length);
  assert.ok(result.written_off >= 1);
  for (const id of warehouseIds) {
    const row = db.prepare("SELECT archived_at, quantity FROM inventory WHERE id = ?").get(id);
    assert.ok(row.archived_at, String(id));
    assert.equal(Number(row.quantity), 0);
  }
  const bag = db.prepare("SELECT archived_at, quantity FROM inventory WHERE id = ?").get(bagId);
  assert.equal(bag.archived_at, null);
  assert.equal(Number(bag.quantity), 2);
});

test("new IM drugs start at zero with configured prices and minimum stock in every location", () => {
  const items = [
    ["IM Adrenaline", 82.68],
    ["IM Atropine", 60],
    ["IM Duron", 106.18],
  ];
  const doctorIds = db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id").all()
    .map((row) => Number(row.id));
  const loadRows = db.prepare(`
    SELECT i.*, f.name AS folder_name
    FROM inventory i JOIN inventory_folders f ON f.id = i.folder_id
    WHERE i.item_name = ? AND i.archived_at IS NULL
    ORDER BY i.stock_scope, i.owner_doctor_id
  `);

  for (const [name, costPrice] of items) {
    const rows = loadRows.all(name);
    assert.equal(rows.length, doctorIds.length + 1, name);
    assert.equal(rows.filter((row) => row.stock_scope === "ocs" && row.owner_doctor_id === null).length, 1, name);
    assert.deepEqual(rows.filter((row) => row.stock_scope === "doctor").map((row) => row.owner_doctor_id), doctorIds, name);
    for (const row of rows) {
      assert.equal(row.folder_name, "IM Drugs", name);
      assert.equal(row.item_kind, "stock", name);
      assert.equal(row.quantity, 0, name);
      assert.equal(row.minimum_quantity, 2, name);
      assert.equal(row.cost_price, costPrice, name);
      assert.equal(row.selling_price, 1200, name);
      assert.equal(row.notes, "", name);
      assert.equal(row.expiry_date, null, name);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_batches WHERE item_id = ?").get(row.id).count, 0, name);
    }
  }

  const warehouse = loadRows.all("IM Adrenaline").find((row) => row.stock_scope === "ocs");
  db.prepare("UPDATE inventory SET quantity = 5, minimum_quantity = 3, cost_price = 90, selling_price = 1250 WHERE id = ?").run(warehouse.id);
  db.prepare(`
    INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost)
    VALUES (?, 5, '2030-12-31', 90)
  `).run(warehouse.id);
  const beforeRetry = items.flatMap(([name]) => loadRows.all(name));
  const retry = alignInventoryCategories();
  assert.equal(retry.inserted, 0);
  assert.deepEqual(items.flatMap(([name]) => loadRows.all(name)), beforeRetry,
    "restarts must not duplicate items or reset received stock, prices or minimum quantities");
  assert.equal(db.prepare("SELECT quantity_remaining FROM inventory_batches WHERE item_id = ?").get(warehouse.id).quantity_remaining, 5);

  const newDoctorId = Number(db.prepare("INSERT INTO doctors (full_name, specialization, is_active) VALUES ('New IM catalogue doctor', 'General Medicine', 1)").run().lastInsertRowid);
  try {
    alignInventoryCategories();
    for (const [name, costPrice] of items) {
      const bag = loadRows.all(name).filter((row) => row.owner_doctor_id === newDoctorId);
      assert.equal(bag.length, 1, name);
      assert.equal(bag[0].quantity, 0, name);
      assert.equal(bag[0].minimum_quantity, 2, name);
      assert.equal(bag[0].cost_price, costPrice, name);
      assert.equal(bag[0].selling_price, 1200, name);
    }
  } finally {
    db.prepare("DELETE FROM inventory WHERE owner_doctor_id = ?").run(newDoctorId);
    db.prepare("DELETE FROM doctors WHERE id = ?").run(newDoctorId);
  }
});

test("Sachet Monuril moves from pediatric drugs to oral drugs in the warehouse and doctor bags", () => {
  assert.equal(ocsOralDrugsPdfCatalog.some((item) => item.name === "Sachet Monuril" && item.category === "Oral Drugs"), true);
  assert.equal(ocsPediatricDrugsPdfCatalog.some((item) => item.name === "Sachet Monuril"), false);
  function folderId(name) {
    return db.prepare("SELECT id FROM inventory_folders WHERE name = ? AND owner_doctor_id IS NULL LIMIT 1").get(name)?.id
      || Number(db.prepare("INSERT INTO inventory_folders (name) VALUES (?)").run(name).lastInsertRowid);
  }
  const pediatricId = folderId("Pediatric Drugs");
  const doctorId = Number(db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id LIMIT 1").get().id);
  const insert = db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price
    ) VALUES ('Sachet Monuril', 'service', ?, ?, ?, ?, 0, 'sachet', 0, 0)
  `);
  const warehouseRow = Number(insert.run(pediatricId, "ocs", null, 0).lastInsertRowid);
  const bagRow = Number(insert.run(pediatricId, "doctor", doctorId, 0).lastInsertRowid);

  alignInventoryCategories();
  const oralId = folderId("Oral Drugs");
  for (const id of [warehouseRow, bagRow]) {
    const row = db.prepare("SELECT folder_id, item_kind, quantity FROM inventory WHERE id = ?").get(id);
    assert.equal(Number(row.folder_id), Number(oralId));
    assert.equal(row.item_kind, "service");
    assert.equal(Number(row.quantity), 0);
  }
});

test("the four wound procedures move to Services in place without changing other records or prices", () => {
  alignInventoryCategories();
  db.exec("SAVEPOINT wound_services_test");
  try {
    const names = [
      "Wound Debridement",
      "Wound dressing-complex care,1st grade",
      "Wound dressing-complex care,2nd grade",
      "Wound Dressing-primary care",
    ];
    const woundFolder = Number(db.prepare("INSERT INTO inventory_folders (name) VALUES ('Wound procedure test folder')").run().lastInsertRowid);
    const servicesFolder = db.prepare("SELECT id FROM inventory_folders WHERE name='Services' AND owner_doctor_id IS NULL LIMIT 1").get().id;
    const doctorId = db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id LIMIT 1").get().id;
    const insert = db.prepare(`INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id,
      quantity, minimum_quantity, unit, cost_price, selling_price, notes
    ) VALUES (?, 'stock', ?, ?, ?, 0, 0, 'unit', 0, ?, 'Existing procedure notes')`);
    const ids = new Set();
    for (const [index, name] of names.entries()) {
      for (const [scope, owner] of [["ocs", null], ["doctor", doctorId]]) {
        const id = Number(insert.run(name, woundFolder, scope, owner, 500 + index * 250).lastInsertRowid);
        ids.add(id);
        db.prepare(`INSERT INTO inventory_movements
          (item_id, movement_type, quantity, previous_quantity, next_quantity, note)
          VALUES (?, 'out', 1, 1, 0, 'Historical entry to preserve')`).run(id);
      }
    }
    insert.run("Wound dressing material to keep", woundFolder, "ocs", null, 150);
    insert.run("Diabetic foot care", woundFolder, "ocs", null, 800);
    const consultation = db.prepare("SELECT id, patient_id FROM consultations ORDER BY id LIMIT 1").get();
    db.prepare(`INSERT INTO billing (consultation_id, patient_id, items, total_amount, status)
      VALUES (?, ?, ?, 0, 'unpaid')`).run(consultation.id, consultation.patient_id,
      JSON.stringify([{ inventory_item_id: [...ids][0], description: names[0], quantity: 1, amount: 0 }]));

    function snapshot(convert = false) {
      return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({ name }) => {
        const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map((row) => {
          if (name !== "inventory" || !ids.has(row.id)) return row;
          const { row_version, updated_at, ...record } = row;
          return convert ? { ...record, folder_id: servicesFolder, item_kind: "service", unit: "service" } : record;
        });
        return [name, rows];
      }));
    }
    const expected = snapshot(true);
    const result = alignInventoryCategories();
    assert.equal(result.inserted, 0, "move the existing entries instead of duplicating them");
    assert.deepEqual(snapshot(), expected, "only the target entries' category, type and unit may change");
    for (const id of ids) {
      const row = db.prepare("SELECT item_kind, folder_id, quantity, minimum_quantity, cost_price, unit, archived_at FROM inventory WHERE id=?").get(id);
      assert.equal(row.item_kind, "service");
      assert.equal(row.folder_id, servicesFolder);
      assert.equal(row.unit, "service");
      assert.equal(row.quantity, 0);
      assert.equal(row.minimum_quantity, 0);
      assert.equal(row.cost_price, 0);
      assert.equal(row.archived_at, null);
    }
    const beforeRetry = db.prepare("SELECT * FROM inventory ORDER BY id").all();
    assert.equal(alignInventoryCategories().updated, 0);
    assert.deepEqual(db.prepare("SELECT * FROM inventory ORDER BY id").all(), beforeRetry);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db.exec("ROLLBACK TO wound_services_test; RELEASE wound_services_test");
  }
});
