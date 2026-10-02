"use strict";

const SUPPLY_FOLDER = "O2 & Nebuliser";
const SERVICE_FOLDER = "Services";
const INTRAFIX_NAME = "Intrafix (Drip Set / Infusion set)";

function stableKey(prefix, value) {
  return `${prefix}:${String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

const MASKS = Object.freeze({
  adult: "Adult Face Mask",
  paediatric: "Paediatric Face Mask",
});

const ENEMAS = Object.freeze({
  adult: "Atomic enema (Adult)",
  paediatric: "Atomic enema (Paediatric)",
});

const CANNULAS = Object.freeze({
  blue: "Cannula (Blue)",
  pink: "Cannula (Pink)",
  green: "Cannula (Green)",
  yellow: "Cannula (Yellow)",
});

const SYRINGES = Object.freeze({
  "3": "Syringe (3ml)",
  "5": "Syringe (5ml)",
  "10": "Syringe (10ml)",
  "20": "Syringe (20ml)",
  "50": "Irrigation Syringe (50ml)",
});

const SALINES = Object.freeze({
  "100": "IV N/S 100ml",
  "500": "IV N/S 500ml",
});

const CATHETERS = Object.freeze({
  "14": "2 Way Foley Catheter (Ch/Fr 14)",
  "16": "2 Way Foley Catheter (Ch/Fr 16)",
  "18": "2 Way Foley Catheter (Ch/Fr 18)",
  "20": "2 Way Foley Catheter (Ch/Fr 20)",
  "22": "2 Way Foley Catheter (Ch/Fr 22)",
});

const NG_TUBES = Object.freeze({
  "14": "NGT (14fg x105cm)",
  "16": "NGT (16fg x105cm)",
  "18": "NGT (18fg x105cm)",
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
    components: [{ role: "cannula", quantity: 1 }],
  },
  {
    itemName: "Removal of sutures or staples removing + Dressing",
    sellingPrice: 1500,
    components: [{ itemName: "Staple remover", quantity: 1 }],
  },
  {
    itemName: "Abdominal tapping",
    sellingPrice: 2500,
    components: [
      { role: "syringe", quantity: 1 },
      { role: "cannula", quantity: 1 },
      { itemName: "Intrafix (Drip Set / Infusion set)", quantity: 1 },
    ],
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
  {
    itemName: "Bladder wash out + N/S",
    components: [
      { role: "syringe", quantity: 1 },
      { role: "saline", quantity: 1 },
    ],
  },
  {
    itemName: "Each next N/S 500ml",
    sellingPrice: 500,
    quantityPrompt: "N/S 500ml used",
    components: [{ itemName: "N/S 500ml", quantity: 1 }],
  },
  {
    itemName: "Removal of catheter",
    components: [],
  },
  {
    itemName: "Bladder Training",
    components: [],
  },
  {
    itemName: "Catherisation",
    components: [
      { role: "catheter", quantity: 1 },
      { role: "syringe", quantity: 1 },
      { role: "saline", quantity: 1 },
    ],
  },
  {
    itemName: "NGT insertion",
    components: [{ role: "ngt", quantity: 1 }],
  },
]);

const DRUG_ADMINISTRATION = Object.freeze({
  im: Object.freeze({
    itemName: "IM drug administration",
    route: "im",
    components: Object.freeze([{ role: "syringe", quantity: 1 }]),
  }),
  iv: Object.freeze({
    itemName: "IV drug administration",
    route: "iv",
    components: Object.freeze([]),
  }),
});

const supplyNames = new Set(SUPPLIES.map((item) => item.itemName.toLowerCase()));
const serviceByCatalogueKey = new Map(
  SERVICES.map((service) => [stableKey("service", service.itemName), service]),
);

const catalogueMetadata = [
  ...SUPPLIES.map((item) => ({
    itemName: item.itemName,
    catalogueKey: stableKey("supply", item.itemName),
    isCostOnly: false,
  })),
  ...SERVICES.map((service) => ({
    itemName: service.itemName,
    catalogueKey: stableKey("service", service.itemName),
    isCostOnly: false,
  })),
  ...Object.entries(MASKS).map(([size, itemName]) => ({ itemName, catalogueKey: `supply:mask:${size}`, isCostOnly: false })),
  ...Object.entries(ENEMAS).map(([size, itemName]) => ({ itemName, catalogueKey: `supply:enema:${size}`, isCostOnly: false })),
  ...Object.entries(CANNULAS).map(([size, itemName]) => ({ itemName, catalogueKey: `consumable:cannula:${size}`, isCostOnly: true })),
  ...Object.entries(SYRINGES).map(([size, itemName]) => ({ itemName, catalogueKey: `consumable:syringe:${size}`, isCostOnly: true })),
  ...Object.entries(SALINES).map(([size, itemName]) => ({ itemName, catalogueKey: `supply:saline:${size}`, isCostOnly: false })),
  ...Object.entries(CATHETERS).map(([size, itemName]) => ({ itemName, catalogueKey: `supply:catheter:${size}`, isCostOnly: false })),
  ...Object.entries(NG_TUBES).map(([size, itemName]) => ({ itemName, catalogueKey: `supply:ngt:${size}`, isCostOnly: false })),
  { itemName: INTRAFIX_NAME, catalogueKey: "consumable:intrafix", isCostOnly: true },
];
const metadataByName = new Map(
  catalogueMetadata.map((entry) => [entry.itemName.trim().toLowerCase(), entry]),
);

function treatmentServiceByName(name) {
  const key = String(name || "").trim().toLowerCase();
  return SERVICES.find((service) => service.itemName.toLowerCase() === key) || null;
}

function treatmentServiceByItem(item) {
  const key = String(item?.catalogue_key || item?.catalogueKey || "").trim().toLowerCase();
  return serviceByCatalogueKey.get(key) || treatmentServiceByName(item?.item_name || item?.itemName);
}

function isTreatmentSupplyName(name) {
  return supplyNames.has(String(name || "").trim().toLowerCase());
}

function isUnchargedConsumable(nameOrItem) {
  if (nameOrItem && typeof nameOrItem === "object") {
    if (Number(nameOrItem.is_cost_only || 0) === 1) return true;
    const catalogueKey = String(nameOrItem.catalogue_key || nameOrItem.catalogueKey || "").trim().toLowerCase();
    if (catalogueKey.startsWith("consumable:")) return true;
  }
  const name = nameOrItem && typeof nameOrItem === "object"
    ? nameOrItem.item_name || nameOrItem.itemName
    : nameOrItem;
  const key = String(name || "").trim().toLowerCase();
  if (key === INTRAFIX_NAME.toLowerCase()) return true;
  if (Object.values(CANNULAS).some((itemName) => itemName.toLowerCase() === key)) return true;
  return Object.values(SYRINGES).some((itemName) => itemName.toLowerCase() === key);
}

function catalogueKeyForName(name) {
  return metadataByName.get(String(name || "").trim().toLowerCase())?.catalogueKey || "";
}

function ensureTreatmentCatalogueMetadata(db) {
  const update = db.prepare(`
    UPDATE inventory
    SET catalogue_key = CASE WHEN trim(COALESCE(catalogue_key, '')) = '' THEN ? ELSE catalogue_key END,
        is_cost_only = CASE WHEN ? = 1 THEN 1 ELSE COALESCE(is_cost_only, 0) END
    WHERE lower(trim(item_name)) = lower(trim(?))
  `);
  let updated = 0;
  for (const entry of catalogueMetadata) {
    updated += Number(update.run(entry.catalogueKey, entry.isCostOnly ? 1 : 0, entry.itemName).changes || 0);
  }
  return updated;
}

function serviceRequiresMask(service) {
  return Boolean(service?.components?.some((component) => component.role === "mask"));
}

function serviceRequiresEnema(service) {
  return Boolean(service?.components?.some((component) => component.role === "enema"));
}

function serviceRequiresCannula(service) {
  return Boolean(service?.components?.some((component) => component.role === "cannula"));
}

function serviceRequiresSyringe(service) {
  return Boolean(service?.components?.some((component) => component.role === "syringe"));
}

function serviceRequiresSaline(service) {
  return Boolean(service?.components?.some((component) => component.role === "saline"));
}

function serviceRequiresCatheter(service) {
  return Boolean(service?.components?.some((component) => component.role === "catheter"));
}

function serviceRequiresNgt(service) {
  return Boolean(service?.components?.some((component) => component.role === "ngt"));
}

function includedLabel(service) {
  if (!service) return "";
  const parts = service.components.map((component) => {
    const name = component.role === "mask"
      ? "face mask"
      : component.role === "enema"
        ? "atomic enema"
        : component.role === "cannula"
          ? "cannula"
          : component.role === "syringe"
            ? "syringe"
            : component.role === "saline"
              ? "N/S"
          : component.role === "catheter"
            ? "Foley catheter"
            : component.role === "ngt"
              ? "NGT"
              : component.itemName;
    return `${component.quantity} ${name}`;
  });
  if (parts.length <= 1) return parts[0] || "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function drugAdministrationByCategory(...categoryNames) {
  const names = categoryNames.map((name) => String(name || "").trim().toLowerCase());
  if (names.includes("im drugs")) return DRUG_ADMINISTRATION.im;
  if (names.includes("iv drugs")) return DRUG_ADMINISTRATION.iv;
  return null;
}

function resolveRecipeComponents(service, {
  maskSize,
  quantity,
  enemaSize,
  cannulaSize,
  catheterSize,
  ngtSize,
  syringeSize,
  salineSize,
} = {}) {
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
    const error = new Error(`Choose Atomic enema (Adult) or Atomic enema (Paediatric) for ${service.itemName}.`);
    error.status = 400;
    error.extra = { code: "TREATMENT_ENEMA_REQUIRED", service_name: service.itemName };
    throw error;
  }
  const cannula = String(cannulaSize || "").trim().toLowerCase();
  if (serviceRequiresCannula(service) && !CANNULAS[cannula]) {
    const error = new Error(`Choose a cannula for ${service.itemName}.`);
    error.status = 400;
    error.extra = { code: "TREATMENT_CANNULA_REQUIRED", service_name: service.itemName };
    throw error;
  }
  const syringe = String(syringeSize || "").trim();
  const skipSyringe = syringe === "0" && service.route === "im";
  if (serviceRequiresSyringe(service) && !SYRINGES[syringe] && !skipSyringe) {
    const error = new Error(`Choose a syringe for ${service.itemName}.`);
    error.status = 400;
    error.extra = { code: "TREATMENT_SYRINGE_REQUIRED", service_name: service.itemName };
    throw error;
  }
  const saline = String(salineSize || "").trim();
  if (serviceRequiresSaline(service) && !SALINES[saline]) {
    const error = new Error(`Choose IV N/S 100ml or IV N/S 500ml for ${service.itemName}.`);
    error.status = 400;
    error.extra = { code: "TREATMENT_SALINE_REQUIRED", service_name: service.itemName };
    throw error;
  }
  const catheter = String(catheterSize || "").trim();
  if (serviceRequiresCatheter(service) && !CATHETERS[catheter]) {
    const error = new Error(`Choose a Foley catheter for ${service.itemName}.`);
    error.status = 400;
    error.extra = { code: "TREATMENT_CATHETER_REQUIRED", service_name: service.itemName };
    throw error;
  }
  const ngt = String(ngtSize || "").trim();
  if (serviceRequiresNgt(service) && !NG_TUBES[ngt]) {
    const error = new Error(`Choose an NGT for ${service.itemName}.`);
    error.status = 400;
    error.extra = { code: "TREATMENT_NGT_REQUIRED", service_name: service.itemName };
    throw error;
  }
  return service.components.filter((component) => !(skipSyringe && component.role === "syringe")).map((component) => {
    const itemName = component.role === "mask"
      ? MASKS[mask]
      : component.role === "enema"
        ? ENEMAS[enema]
        : component.role === "cannula"
          ? CANNULAS[cannula]
          : component.role === "syringe"
            ? SYRINGES[syringe]
            : component.role === "saline"
              ? SALINES[saline]
          : component.role === "catheter"
            ? CATHETERS[catheter]
            : component.role === "ngt"
              ? NG_TUBES[ngt]
              : component.itemName;
    return {
      itemName,
      catalogueKey: catalogueKeyForName(itemName),
      quantity: component.quantity * copies,
    };
  });
}

function resolveTreatmentComponents(
  serviceItem,
  maskSize,
  quantity,
  enemaSize,
  cannulaSize,
  catheterSize,
  ngtSize,
  syringeSize,
  salineSize,
) {
  return resolveRecipeComponents(
    serviceItem && typeof serviceItem === "object"
      ? treatmentServiceByItem(serviceItem)
      : treatmentServiceByName(serviceItem), {
    maskSize,
    quantity,
    enemaSize,
    cannulaSize,
    catheterSize,
    ngtSize,
    syringeSize,
    salineSize,
    },
  );
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

function findCatalogueRow(db, scope, ownerDoctorId, itemName, catalogueKey = "") {
  if (scope === "doctor") {
    return db.prepare(`
      SELECT id, item_kind
      FROM inventory
      WHERE stock_scope = 'doctor'
        AND owner_doctor_id = ?
        AND (
          (? != '' AND catalogue_key = ?)
          OR lower(trim(item_name)) = lower(trim(?))
        )
      ORDER BY CASE WHEN ? != '' AND catalogue_key = ? THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `).get(ownerDoctorId, catalogueKey, catalogueKey, itemName, catalogueKey, catalogueKey);
  }
  return db.prepare(`
    SELECT id, item_kind
    FROM inventory
    WHERE stock_scope = 'ocs'
      AND owner_doctor_id IS NULL
      AND (
        (? != '' AND catalogue_key = ?)
        OR lower(trim(item_name)) = lower(trim(?))
      )
    ORDER BY CASE WHEN ? != '' AND catalogue_key = ? THEN 0 ELSE 1 END, id ASC
    LIMIT 1
  `).get(catalogueKey, catalogueKey, itemName, catalogueKey, catalogueKey);
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
      unit, cost_price, selling_price, notes, attributes, moa_notes, expiry_date,
      catalogue_key, is_cost_only, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, 0, ?, '', '', '', NULL, ?, ?, CURRENT_TIMESTAMP)
  `);
  const placeSupply = db.prepare(`
    UPDATE inventory
    SET item_kind = 'stock',
        folder_id = ?,
        catalogue_key = CASE WHEN trim(COALESCE(catalogue_key, '')) = '' THEN ? ELSE catalogue_key END,
        is_cost_only = CASE WHEN ? = 1 THEN 1 ELSE COALESCE(is_cost_only, 0) END
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
        catalogue_key = CASE WHEN trim(COALESCE(catalogue_key, '')) = '' THEN ? ELSE catalogue_key END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND archived_at IS NULL
  `);

  const ensured = db.transaction(() => {
    let inserted = 0;
    for (const location of locations) {
      for (const supply of SUPPLIES) {
        const supplyKey = catalogueKeyForName(supply.itemName);
        const existing = findCatalogueRow(db, location.scope, location.ownerDoctorId, supply.itemName, supplyKey);
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
            supplyKey,
            isUnchargedConsumable(supply.itemName) ? 1 : 0,
          );
          inserted += 1;
        } else {
          placeSupply.run(
            supplyFolderId,
            supplyKey,
            isUnchargedConsumable(supply.itemName) ? 1 : 0,
            existing.id,
          );
        }
      }
      for (const service of SERVICES) {
        const price = Number(service.sellingPrice || 0);
        const serviceKey = stableKey("service", service.itemName);
        const existing = findCatalogueRow(db, location.scope, location.ownerDoctorId, service.itemName, serviceKey);
        if (!existing) {
          insert.run(
            service.itemName,
            "service",
            serviceFolder,
            location.scope,
            location.ownerDoctorId,
            "service",
            price,
            serviceKey,
            0,
          );
          inserted += 1;
        } else {
          placeService.run(
            serviceFolder,
            price,
            price,
            serviceKey,
            existing.id,
          );
          db.prepare(`
            UPDATE inventory_batches
            SET quantity_remaining = 0
            WHERE quantity_remaining != 0
              AND item_id = ?
          `).run(existing.id);
        }
      }
    }
    return inserted;
  });
  const inserted = ensured();
  const metadataUpdated = ensureTreatmentCatalogueMetadata(db);
  return { inserted, metadataUpdated };
}

module.exports = {
  CANNULAS,
  DRUG_ADMINISTRATION,
  ENEMAS,
  MASKS,
  SALINES,
  SERVICES,
  SUPPLIES,
  SYRINGES,
  catalogueKeyForName,
  ensureTreatmentCatalogue,
  ensureTreatmentCatalogueMetadata,
  drugAdministrationByCategory,
  includedLabel,
  isTreatmentSupplyName,
  isUnchargedConsumable,
  resolveTreatmentComponents,
  resolveRecipeComponents,
  serviceRequiresCannula,
  serviceRequiresCatheter,
  serviceRequiresEnema,
  serviceRequiresNgt,
  serviceRequiresMask,
  serviceRequiresSaline,
  serviceRequiresSyringe,
  treatmentServiceByName,
  treatmentServiceByItem,
};
