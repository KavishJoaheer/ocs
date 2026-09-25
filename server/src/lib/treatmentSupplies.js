"use strict";

const SUPPLY_FOLDER = "O2 & Nebuliser";
const SERVICE_FOLDER = "Services";

const MASKS = Object.freeze({
  adult: "Adult Face Mask",
  paediatric: "Paediatric Face Mask",
});

const ENEMAS = Object.freeze({
  adult: "Atomic enema (Adult)",
  paediatric: "Atomic enema (Paediatric)",
});

const SUPPLIES = Object.freeze([
  { itemName: "Dulopro nebule", unit: "nebule" },
  { itemName: "Pulmicort nebule", unit: "nebule" },
  { itemName: "Adult Face Mask", unit: "mask" },
  { itemName: "Paediatric Face Mask", unit: "mask" },
  { itemName: "Atomic enema (Adult)", unit: "enema", folderName: "Consumable" },
  { itemName: "Atomic enema (Paediatric)", unit: "enema", folderName: "Consumable" },
  { itemName: "Staple remover", unit: "unit", folderName: "Consumable" },
]);

const SERVICES = Object.freeze([
  {
    itemName: "Nebulizer ( incl mask and 1 Dulopro nebule)",
    components: [
      { role: "mask", quantity: 1 },
      { itemName: "Dulopro nebule", quantity: 1 },
    ],
  },
  {
    itemName: "Nebulizer ( incl mask and 1 Pulmicort nebule)",
    components: [
      { role: "mask", quantity: 1 },
      { itemName: "Pulmicort nebule", quantity: 1 },
    ],
  },
  {
    itemName: "Nebulizer ( incl mask and 1 Pulmicort + Dulopro)",
    components: [
      { role: "mask", quantity: 1 },
      { itemName: "Pulmicort nebule", quantity: 1 },
      { itemName: "Dulopro nebule", quantity: 1 },
    ],
  },
  {
    itemName: "O2 with mask ( 1st 30mins)",
    components: [{ role: "mask", quantity: 1 }],
  },
  {
    itemName: "O2 with mask ( 1st 30mins) + Pulmicort",
    components: [
      { role: "mask", quantity: 1 },
      { itemName: "Pulmicort nebule", quantity: 1 },
    ],
  },
  {
    itemName: "O2 with mask ( 1st 30mins) + Dulopro",
    components: [
      { role: "mask", quantity: 1 },
      { itemName: "Dulopro nebule", quantity: 1 },
    ],
  },
  {
    itemName: "O2 with mask ( 1st 30mins) + Pulmicort + Dulopro",
    components: [
      { role: "mask", quantity: 1 },
      { itemName: "Pulmicort nebule", quantity: 1 },
      { itemName: "Dulopro nebule", quantity: 1 },
    ],
  },
  {
    itemName: "Each additional 30 mins O2",
    components: [],
  },
  {
    itemName: "Administration Fees (only when administration is done)",
    sellingPrice: 500,
    components: [],
  },
  {
    itemName: "IV Cannulation only",
    sellingPrice: 1000,
    components: [],
  },
  {
    itemName: "Removal of sutures or staples removing + Dressing",
    sellingPrice: 1500,
    components: [{ itemName: "Staple remover", quantity: 1 }],
  },
  {
    itemName: "Abdominal tapping",
    sellingPrice: 2500,
    components: [],
  },
  {
    itemName: "PR (including sterile gloves and gel)",
    sellingPrice: 800,
    components: [],
  },
  {
    itemName: "PR + Atomic enema",
    sellingPrice: 1000,
    components: [{ role: "enema", quantity: 1 }],
  },
  {
    itemName: "Manual Evac only",
    sellingPrice: 1500,
    components: [],
  },
  {
    itemName: "Manual Evac + Atomic enema",
    sellingPrice: 2000,
    components: [{ role: "enema", quantity: 1 }],
  },
  {
    itemName: "Ear Syringing",
    sellingPrice: 800,
    components: [],
  },
]);

const supplyNames = new Set(SUPPLIES.map((item) => item.itemName.toLowerCase()));

function treatmentServiceByName(name) {
  const key = String(name || "").trim().toLowerCase();
  return SERVICES.find((service) => service.itemName.toLowerCase() === key) || null;
}

function isTreatmentSupplyName(name) {
  return supplyNames.has(String(name || "").trim().toLowerCase());
}

function serviceRequiresMask(service) {
  return Boolean(service?.components?.some((component) => component.role === "mask"));
}

function serviceRequiresEnema(service) {
  return Boolean(service?.components?.some((component) => component.role === "enema"));
}

function includedLabel(service) {
  if (!service) return "";
  const parts = service.components.map((component) => {
    const name = component.role === "mask"
      ? "face mask"
      : component.role === "enema"
        ? "atomic enema"
        : component.itemName;
    return `${component.quantity} ${name}`;
  });
  if (parts.length <= 1) return parts[0] || "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function resolveTreatmentComponents(serviceName, maskSize, quantity, enemaSize) {
  const service = treatmentServiceByName(serviceName);
  if (!service) return null;
  const copies = Number(quantity || 0);
  if (!Number.isInteger(copies) || copies <= 0) {
    const error = new Error(`Enter a whole quantity for ${service.itemName}.`);
    error.status = 400;
    throw error;
  }
  const mask = String(maskSize || "").trim().toLowerCase();
  if (serviceRequiresMask(service) && !MASKS[mask]) {
    const error = new Error(`Choose Adult or Paediatric face mask for ${service.itemName}.`);
    error.status = 400;
    error.extra = { code: "TREATMENT_MASK_REQUIRED", service_name: service.itemName };
    throw error;
  }
  const enema = String(enemaSize || "").trim().toLowerCase();
  if (serviceRequiresEnema(service) && !ENEMAS[enema]) {
    const error = new Error(`Choose Adult or Paediatric atomic enema for ${service.itemName}.`);
    error.status = 400;
    error.extra = { code: "TREATMENT_ENEMA_REQUIRED", service_name: service.itemName };
    throw error;
  }
  return service.components.map((component) => ({
    itemName: component.role === "mask"
      ? MASKS[mask]
      : component.role === "enema"
        ? ENEMAS[enema]
        : component.itemName,
    quantity: component.quantity * copies,
  }));
}

function folderId(db, name) {
  const existing = db.prepare(`
    SELECT id
    FROM inventory_folders
    WHERE name = ?
      AND owner_doctor_id IS NULL
    ORDER BY id ASC
    LIMIT 1
  `).get(name);
  if (existing) return Number(existing.id);
  return Number(db.prepare(`
    INSERT INTO inventory_folders (name, parent_id, owner_doctor_id, updated_at)
    VALUES (?, NULL, NULL, CURRENT_TIMESTAMP)
  `).run(name).lastInsertRowid);
}

function findCatalogueRow(db, scope, ownerDoctorId, itemName) {
  if (scope === "doctor") {
    return db.prepare(`
      SELECT id, item_kind
      FROM inventory
      WHERE stock_scope = 'doctor'
        AND owner_doctor_id = ?
        AND lower(trim(item_name)) = lower(trim(?))
      ORDER BY id ASC
      LIMIT 1
    `).get(ownerDoctorId, itemName);
  }
  return db.prepare(`
    SELECT id, item_kind
    FROM inventory
    WHERE stock_scope = 'ocs'
      AND owner_doctor_id IS NULL
      AND lower(trim(item_name)) = lower(trim(?))
    ORDER BY id ASC
    LIMIT 1
  `).get(itemName);
}

function ensureTreatmentCatalogue(db, { doctorId = null } = {}) {
  const serviceFolder = folderId(db, SERVICE_FOLDER);
  const locations = [{ scope: "ocs", ownerDoctorId: null }];
  const doctors = doctorId
    ? [{ id: Number(doctorId) }]
    : db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL").all();
  for (const doctor of doctors) {
    if (Number(doctor.id) > 0) locations.push({ scope: "doctor", ownerDoctorId: Number(doctor.id) });
  }

  const insert = db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity,
      unit, cost_price, selling_price, notes, attributes, moa_notes, expiry_date, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, 0, ?, '', '', '', NULL, CURRENT_TIMESTAMP)
  `);
  const keepSupplyUnpriced = db.prepare(`
    UPDATE inventory
    SET item_kind = 'stock',
        folder_id = ?,
        selling_price = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const placeService = db.prepare(`
    UPDATE inventory
    SET item_kind = 'service',
        folder_id = ?,
        quantity = 0,
        minimum_quantity = 0,
        selling_price = CASE
          WHEN COALESCE(selling_price, 0) <= 0 AND ? > 0 THEN ?
          ELSE selling_price
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const ensured = db.transaction(() => {
    let inserted = 0;
    for (const location of locations) {
      for (const supply of SUPPLIES) {
        const existing = findCatalogueRow(db, location.scope, location.ownerDoctorId, supply.itemName);
        const supplyFolderId = folderId(db, supply.folderName || SUPPLY_FOLDER);
        if (!existing) {
          insert.run(
            supply.itemName,
            "stock",
            supplyFolderId,
            location.scope,
            location.ownerDoctorId,
            supply.unit,
            0,
          );
          inserted += 1;
        } else {
          keepSupplyUnpriced.run(supplyFolderId, existing.id);
        }
      }
      for (const service of SERVICES) {
        const price = Number(service.sellingPrice || 0);
        const existing = findCatalogueRow(db, location.scope, location.ownerDoctorId, service.itemName);
        if (!existing) {
          insert.run(
            service.itemName,
            "service",
            serviceFolder,
            location.scope,
            location.ownerDoctorId,
            "service",
            price,
          );
          inserted += 1;
        } else {
          placeService.run(serviceFolder, price, price, existing.id);
        }
      }
    }
    return inserted;
  });
  return { inserted: ensured() };
}

module.exports = {
  ENEMAS,
  MASKS,
  SERVICES,
  SUPPLIES,
  ensureTreatmentCatalogue,
  includedLabel,
  isTreatmentSupplyName,
  resolveTreatmentComponents,
  serviceRequiresEnema,
  serviceRequiresMask,
  treatmentServiceByName,
};
