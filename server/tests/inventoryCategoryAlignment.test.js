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
  assert.equal(first.inserted, 4 * (activeDoctorCount + 1));
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
    ["IM Ceftriaxone 1g + lidocaine", 300, 1200],
    ["IV Solu-cortef 100MG (Hisone) (including cannulation)", 300, 2000],
    ["Each next N/S 500ml", 100, 500],
    ["IV Lasilix 20mg", 200, 800],
  ];
  for (const [itemName, costPrice, sellingPrice] of expectedServices) {
    const serviceRows = db.prepare(`
      SELECT i.item_kind, i.quantity, i.minimum_quantity, i.unit,
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
      assert.equal(Number(service.quantity), 0, itemName);
      assert.equal(Number(service.minimum_quantity), 0, itemName);
      assert.equal(Number(service.cost_price), costPrice, itemName);
      assert.equal(Number(service.selling_price), sellingPrice, itemName);
      assert.equal(service.expiry_date, null, itemName);
    }
  }

  const retry = alignInventoryCategories();
  assert.equal(retry.updated, 0, "alignment must be idempotent");
  assert.equal(retry.inserted, 0);
  assert.equal(retry.renamed, 0);
  assert.equal(retry.conflicts, 0);
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
