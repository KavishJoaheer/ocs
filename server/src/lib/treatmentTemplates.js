"use strict";

const { CANNULAS, SYRINGES } = require("./treatmentSupplies");
const { decorateInventoryItems } = require("./inventoryStockState");

const ROLE_CHOICES = Object.freeze({
  cannula: Object.freeze({ label: "Cannula", choices: CANNULAS }),
  syringe: Object.freeze({ label: "Syringe", choices: SYRINGES }),
});

const DEFAULT_TEMPLATE = Object.freeze({
  code: "iv_vomiting_fever_weakness_epigastric_pain",
  name: "IV treatment — vomiting, fever, general weakness & epigastric pain",
  components: Object.freeze([
    { component_type: "billable", item_name: "Emetino 4mg (IV/IM) box of 10", quantity: 1 },
    { component_type: "billable", item_name: "Nexium", quantity: 2 },
    { component_type: "billable", item_name: "N/S 500ml", quantity: 1 },
    { component_type: "billable", item_name: "Pabrinex 5ml (box of 6)/ Previta", quantity: 1 },
    { component_type: "billable", item_name: "IV Perfalgan 1g (Paracetamol)", quantity: 1 },
    { component_type: "included", selection_role: "syringe", quantity: 1 },
    { component_type: "included", selection_role: "cannula", quantity: 1 },
    { component_type: "included", item_name: "Intrafix (Drip Set / Infusion set)", quantity: 1 },
  ]),
});

function ensureTreatmentTemplateSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS treatment_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_by_user_id INTEGER,
      updated_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS treatment_template_components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      component_type TEXT NOT NULL CHECK (component_type IN ('billable', 'included')),
      item_name TEXT NOT NULL DEFAULT '',
      selection_role TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES treatment_templates(id) ON DELETE RESTRICT,
      CHECK (
        (TRIM(item_name) != '' AND TRIM(selection_role) = '')
        OR (TRIM(item_name) = '' AND TRIM(selection_role) != '')
      )
    );
    CREATE INDEX IF NOT EXISTS idx_treatment_template_components_template
      ON treatment_template_components(template_id, component_type, sort_order, id);
    CREATE TABLE IF NOT EXISTS treatment_template_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      actor_user_id INTEGER,
      actor_name TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES treatment_templates(id) ON DELETE RESTRICT,
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_treatment_template_events_template
      ON treatment_template_events(template_id, id);
    CREATE TRIGGER IF NOT EXISTS treatment_template_events_no_update
      BEFORE UPDATE ON treatment_template_events BEGIN
        SELECT RAISE(ABORT, 'Treatment template history is append-only');
      END;
    CREATE TRIGGER IF NOT EXISTS treatment_template_events_no_delete
      BEFORE DELETE ON treatment_template_events BEGIN
        SELECT RAISE(ABORT, 'Treatment template history is append-only');
      END;
  `);

  db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO treatment_templates (code, name, active)
      VALUES (?, ?, 1)
    `).run(DEFAULT_TEMPLATE.code, DEFAULT_TEMPLATE.name);
    const template = db.prepare("SELECT id FROM treatment_templates WHERE code = ?").get(DEFAULT_TEMPLATE.code);
    if (!template) return;
    const count = Number(db.prepare(
      "SELECT COUNT(*) AS count FROM treatment_template_components WHERE template_id = ?",
    ).get(template.id)?.count || 0);
    if (count) return;
    const insert = db.prepare(`
      INSERT INTO treatment_template_components (
        template_id, component_type, item_name, selection_role, quantity, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    DEFAULT_TEMPLATE.components.forEach((component, index) => {
      insert.run(
        template.id,
        component.component_type,
        component.item_name || "",
        component.selection_role || "",
        component.quantity,
        index,
      );
    });
  })();
}

function componentRows(db, templateIds) {
  if (!templateIds.length) return [];
  const placeholders = templateIds.map(() => "?").join(",");
  return db.prepare(`
    SELECT id, template_id, component_type, item_name, selection_role, quantity, sort_order
    FROM treatment_template_components
    WHERE template_id IN (${placeholders})
    ORDER BY template_id, component_type, sort_order, id
  `).all(...templateIds);
}

function listTreatmentTemplates(db, { activeOnly = false } = {}) {
  const templates = db.prepare(`
    SELECT id, code, name, active, created_at, updated_at
    FROM treatment_templates
    ${activeOnly ? "WHERE active = 1" : ""}
    ORDER BY active DESC, name COLLATE NOCASE, id
  `).all();
  const components = componentRows(db, templates.map((row) => Number(row.id)));
  const byTemplate = new Map();
  for (const component of components) {
    const key = Number(component.template_id);
    if (!byTemplate.has(key)) byTemplate.set(key, []);
    byTemplate.get(key).push({
      id: Number(component.id),
      component_type: component.component_type,
      item_name: component.item_name || "",
      selection_role: component.selection_role || "",
      quantity: Number(component.quantity),
      sort_order: Number(component.sort_order),
    });
  }
  return templates.map((template) => ({
    id: Number(template.id),
    code: template.code || null,
    name: template.name,
    active: Boolean(template.active),
    created_at: template.created_at,
    updated_at: template.updated_at,
    components: byTemplate.get(Number(template.id)) || [],
  }));
}

function rolePayload() {
  return Object.entries(ROLE_CHOICES).map(([key, role]) => ({
    key,
    label: role.label,
    choices: Object.entries(role.choices).map(([value, itemName]) => ({ value, item_name: itemName })),
  }));
}

function adminTreatmentTemplatePayload(db) {
  const stockItems = db.prepare(`
    SELECT item_name
    FROM inventory
    WHERE stock_scope = 'ocs'
      AND owner_doctor_id IS NULL
      AND archived_at IS NULL
      AND COALESCE(item_kind, 'stock') = 'stock'
    GROUP BY lower(trim(item_name))
    ORDER BY item_name COLLATE NOCASE
  `).all().map((row) => row.item_name);
  const metrics = treatmentTemplateMetrics(db);
  return {
    templates: listTreatmentTemplates(db).map((template) => ({
      ...template,
      metrics: metrics.get(template.id) || {
        treatment_count: 0,
        charged_amount: 0,
        charged_stock_cost_amount: 0,
        included_consumable_cost_amount: 0,
        total_stock_cost_amount: 0,
        gross_margin_amount: 0,
      },
    })),
    stock_items: stockItems,
    selection_roles: rolePayload(),
  };
}

function treatmentTemplateMetrics(db) {
  const metrics = new Map();
  const rows = db.prepare(`
    SELECT b.items
    FROM billing b
    JOIN consultations c ON c.id = b.consultation_id
    WHERE b.voided_at IS NULL
      AND c.voided_at IS NULL
      AND b.finalized_at IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM billing_lite_submissions submission
        WHERE submission.billing_id = b.id
          AND submission.reversed_at IS NULL
          AND submission.workflow_status NOT IN ('corrected', 'reversed', 'superseded')
      )
  `).all();
  for (const row of rows) {
    let items = [];
    try { items = JSON.parse(row.items || "[]"); } catch { items = []; }
    for (const item of Array.isArray(items) ? items : []) {
      for (const snapshot of Array.isArray(item?.treatment_templates) ? item.treatment_templates : []) {
        const templateId = Number(snapshot?.template_id || 0);
        if (!templateId) continue;
        if (!metrics.has(templateId)) {
          metrics.set(templateId, {
            treatment_count: 0,
            charged_amount: 0,
            charged_stock_cost_amount: 0,
            included_consumable_cost_amount: 0,
            total_stock_cost_amount: 0,
            gross_margin_amount: 0,
          });
        }
        const current = metrics.get(templateId);
        const chargedCost = (Array.isArray(snapshot.charged_items) ? snapshot.charged_items : []).reduce(
          (sum, charged) => {
            const billedLine = items.find((candidate) => Number(candidate?.inventory_item_id || 0) === Number(charged?.inventory_item_id || 0));
            const movementIds = [...new Set([
              ...(billedLine?.inventory_movement_ids || []),
              ...(billedLine?.dispensing_movement_ids || []),
            ].map(Number).filter(Boolean))];
            if (!movementIds.length) return sum + Number(charged?.cost_amount || 0);
            const placeholders = movementIds.map(() => "?").join(",");
            const movement = db.prepare(`
              SELECT COALESCE(SUM(quantity), 0) AS quantity,
                COALESCE(SUM(quantity * COALESCE(unit_cost_snapshot, 0)), 0) AS cost
              FROM inventory_movements
              WHERE id IN (${placeholders}) AND item_id = ?
            `).get(...movementIds, Number(charged.inventory_item_id));
            const movementQuantity = Number(movement?.quantity || 0);
            return sum + (movementQuantity > 0
              ? (Number(movement?.cost || 0) / movementQuantity) * Number(charged?.quantity || 0)
              : Number(charged?.cost_amount || 0));
          },
          0,
        );
        const anchorMovementIds = [...new Set((item?.inventory_movement_ids || []).map(Number).filter(Boolean))];
        let includedCost = Number(snapshot.included_cost_amount || 0);
        if (anchorMovementIds.length) {
          const placeholders = anchorMovementIds.map(() => "?").join(",");
          const movement = db.prepare(`
            SELECT COUNT(*) AS movement_count,
              COALESCE(SUM(quantity * COALESCE(unit_cost_snapshot, 0)), 0) AS cost
            FROM inventory_movements
            WHERE id IN (${placeholders})
              AND CAST(json_extract(meta_json, '$.treatment_template_id') AS INTEGER) = ?
          `).get(...anchorMovementIds, templateId);
          if (Number(movement?.movement_count || 0) > 0) includedCost = Number(movement.cost || 0);
        }
        current.treatment_count += Number(snapshot.quantity || 1);
        current.charged_amount += Number(snapshot.charged_amount || 0);
        current.charged_stock_cost_amount += chargedCost || Number(snapshot.charged_cost_amount || 0);
        current.included_consumable_cost_amount += includedCost;
      }
    }
  }
  for (const current of metrics.values()) {
    current.charged_amount = Number(current.charged_amount.toFixed(2));
    current.charged_stock_cost_amount = Number(current.charged_stock_cost_amount.toFixed(2));
    current.included_consumable_cost_amount = Number(current.included_consumable_cost_amount.toFixed(2));
    current.total_stock_cost_amount = Number((current.charged_stock_cost_amount + current.included_consumable_cost_amount).toFixed(2));
    current.gross_margin_amount = Number((current.charged_amount - current.total_stock_cost_amount).toFixed(2));
  }
  return metrics;
}

function normalizeTemplateInput(db, body) {
  const name = String(body?.name || "").trim();
  if (name.length < 3 || name.length > 160) {
    throw Object.assign(new Error("Treatment template name must contain 3 to 160 characters."), { status: 400 });
  }
  const rawComponents = Array.isArray(body?.components) ? body.components : [];
  if (!rawComponents.length || rawComponents.length > 40) {
    throw Object.assign(new Error("Add between 1 and 40 treatment components."), { status: 400 });
  }
  const knownItems = new Set(db.prepare(`
    SELECT lower(trim(item_name)) AS item_key
    FROM inventory
    WHERE stock_scope = 'ocs' AND owner_doctor_id IS NULL
      AND archived_at IS NULL AND COALESCE(item_kind, 'stock') = 'stock'
  `).all().map((row) => row.item_key));
  const componentKeys = new Set();
  const components = rawComponents.map((component, index) => {
    const componentType = String(component?.component_type || "").trim();
    const itemName = String(component?.item_name || "").trim();
    const selectionRole = String(component?.selection_role || "").trim().toLowerCase();
    const quantity = Number(component?.quantity || 0);
    if (!['billable', 'included'].includes(componentType)) {
      throw Object.assign(new Error(`Treatment component ${index + 1} has an invalid type.`), { status: 400 });
    }
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 100) {
      throw Object.assign(new Error(`Treatment component ${index + 1} needs a whole quantity from 1 to 100.`), { status: 400 });
    }
    if (selectionRole) {
      if (componentType !== 'included' || !ROLE_CHOICES[selectionRole] || itemName) {
        throw Object.assign(new Error(`Treatment component ${index + 1} has an invalid clinician selection.`), { status: 400 });
      }
    } else if (!itemName || !knownItems.has(itemName.toLowerCase())) {
      throw Object.assign(new Error(`${itemName || `Component ${index + 1}`} is not an active OCS stock item.`), { status: 400 });
    }
    const componentKey = selectionRole ? `role:${selectionRole}` : `item:${itemName.toLowerCase()}`;
    if (componentKeys.has(componentKey)) {
      throw Object.assign(new Error(`${itemName || ROLE_CHOICES[selectionRole]?.label || 'A component'} appears more than once. Use one row with the total quantity.`), { status: 400 });
    }
    componentKeys.add(componentKey);
    return {
      component_type: componentType,
      item_name: selectionRole ? "" : itemName,
      selection_role: selectionRole,
      quantity,
      sort_order: index,
    };
  });
  if (!components.some((component) => component.component_type === 'billable')) {
    throw Object.assign(new Error("Each treatment template needs at least one item charged to the patient."), { status: 400 });
  }
  if (!components.some((component) => component.component_type === 'included')) {
    throw Object.assign(new Error("Each treatment template needs at least one included consumable."), { status: 400 });
  }
  return { name, active: body?.active !== false, components };
}

function saveTreatmentTemplate(db, { templateId = null, body, actor = {} }) {
  const input = normalizeTemplateInput(db, body);
  let savedId = Number(templateId || 0);
  db.transaction(() => {
    const before = savedId
      ? listTreatmentTemplates(db).find((template) => template.id === savedId) || null
      : null;
    if (savedId && !before) {
      throw Object.assign(new Error("Treatment template not found."), { status: 404 });
    }
    try {
      if (savedId) {
        db.prepare(`
          UPDATE treatment_templates
          SET name = ?, active = ?, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(input.name, input.active ? 1 : 0, actor.id || null, savedId);
        db.prepare("DELETE FROM treatment_template_components WHERE template_id = ?").run(savedId);
      } else {
        savedId = Number(db.prepare(`
          INSERT INTO treatment_templates (name, active, created_by_user_id, updated_by_user_id)
          VALUES (?, ?, ?, ?)
        `).run(input.name, input.active ? 1 : 0, actor.id || null, actor.id || null).lastInsertRowid);
      }
    } catch (error) {
      if (/unique/i.test(String(error?.message || ""))) {
        throw Object.assign(new Error("A treatment template already uses this name."), { status: 409 });
      }
      throw error;
    }
    const insert = db.prepare(`
      INSERT INTO treatment_template_components (
        template_id, component_type, item_name, selection_role, quantity, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const component of input.components) {
      insert.run(
        savedId,
        component.component_type,
        component.item_name,
        component.selection_role,
        component.quantity,
        component.sort_order,
      );
    }
    const after = listTreatmentTemplates(db).find((template) => template.id === savedId);
    db.prepare(`
      INSERT INTO treatment_template_events (
        template_id, actor_user_id, actor_name, event_type, before_json, after_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      savedId,
      actor.id || null,
      String(actor.full_name || actor.username || ""),
      before ? "updated" : "created",
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
    );
  })();
  return listTreatmentTemplates(db).find((template) => template.id === savedId);
}

function doctorStockByName(db, doctorId) {
  const rows = decorateInventoryItems(db.prepare(`
    SELECT * FROM inventory
    WHERE stock_scope = 'doctor'
      AND owner_doctor_id = ?
      AND archived_at IS NULL
      AND COALESCE(item_kind, 'stock') = 'stock'
    ORDER BY id
  `).all(Number(doctorId)));
  return new Map(rows.map((item) => [String(item.item_name || "").trim().toLowerCase(), item]));
}

function stockView(item) {
  if (!item) return null;
  return {
    inventory_item_id: Number(item.id),
    item_name: item.item_name,
    unit: item.unit || "unit",
    selling_price: Number(item.selling_price || 0),
    available_to_use: Number(item.available_to_promise ?? item.available_to_use ?? 0),
    cost_price_ready: Number(item.cost_price || 0) > 0,
    selling_price_ready: Number(item.selling_price || 0) > 0,
  };
}

function treatmentTemplatesForDoctor(db, doctorId) {
  const stock = doctorStockByName(db, doctorId);
  return listTreatmentTemplates(db, { activeOnly: true }).map((template) => {
    const components = template.components.map((component) => {
      if (component.selection_role) {
        const role = ROLE_CHOICES[component.selection_role];
        const choices = Object.entries(role?.choices || {}).map(([value, itemName]) => ({
          value,
          ...stockView(stock.get(itemName.toLowerCase())),
          item_name: itemName,
        }));
        return { ...component, role_label: role?.label || component.selection_role, choices };
      }
      return { ...component, ...stockView(stock.get(component.item_name.toLowerCase())) };
    });
    const ready = components.every((component) => {
      if (component.selection_role) {
        return component.choices.some((choice) =>
          choice.inventory_item_id && choice.cost_price_ready && choice.available_to_use >= component.quantity,
        );
      }
      if (!component.inventory_item_id || !component.cost_price_ready || component.available_to_use < component.quantity) return false;
      return component.component_type !== 'billable' || component.selling_price_ready;
    });
    return { ...template, components, ready };
  });
}

function resolveRoleItemName(roleKey, selectedValue) {
  const role = ROLE_CHOICES[String(roleKey || "").trim().toLowerCase()];
  const itemName = role?.choices?.[String(selectedValue || "").trim().toLowerCase()];
  if (!itemName) {
    throw Object.assign(new Error(`Choose a valid ${role?.label || roleKey} for this treatment.`), {
      status: 400,
      extra: { code: "TREATMENT_TEMPLATE_SELECTION_REQUIRED", selection_role: roleKey },
    });
  }
  return itemName;
}

function resolveTreatmentTemplateSelections(db, { doctorId, selections, billedQuantities }) {
  const requested = Array.isArray(selections) ? selections : [];
  if (requested.length > 10) {
    throw Object.assign(new Error("A billing submission can contain up to 10 treatment templates."), { status: 400 });
  }
  const activeTemplates = new Map(listTreatmentTemplates(db, { activeOnly: true }).map((template) => [template.id, template]));
  const stock = doctorStockByName(db, doctorId);
  const instances = [];
  const requiredBillable = new Map();
  const seen = new Set();
  for (const requestedTemplate of requested) {
    const templateId = Number(requestedTemplate?.template_id || 0);
    const quantity = Number(requestedTemplate?.quantity || 1);
    if (!Number.isInteger(templateId) || templateId <= 0 || seen.has(templateId)) {
      throw Object.assign(new Error("Each selected treatment template must be valid and unique."), { status: 400 });
    }
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 10) {
      throw Object.assign(new Error("Treatment template quantity must be a whole number from 1 to 10."), { status: 400 });
    }
    const template = activeTemplates.get(templateId);
    if (!template) {
      throw Object.assign(new Error("A selected treatment template is no longer active."), { status: 409 });
    }
    seen.add(templateId);
    const selectedValues = requestedTemplate?.selections && typeof requestedTemplate.selections === 'object'
      ? requestedTemplate.selections
      : {};
    const billableComponents = [];
    const includedComponents = [];
    for (const component of template.components) {
      const itemName = component.selection_role
        ? resolveRoleItemName(component.selection_role, selectedValues[component.selection_role])
        : component.item_name;
      const item = stock.get(itemName.toLowerCase());
      if (!item) {
        throw Object.assign(new Error(`${itemName} is not in this doctor's bag, so ${template.name} cannot be used.`), {
          status: 409,
          extra: { code: "TREATMENT_SUPPLY_MISSING", item_name: itemName, template_id: template.id },
        });
      }
      const resolved = {
        itemId: Number(item.id),
        itemName,
        quantity: component.quantity * quantity,
        selection_role: component.selection_role || "",
      };
      if (component.component_type === 'billable') {
        billableComponents.push(resolved);
        requiredBillable.set(resolved.itemId, (requiredBillable.get(resolved.itemId) || 0) + resolved.quantity);
      } else {
        includedComponents.push(resolved);
      }
    }
    instances.push({
      id: template.id,
      name: template.name,
      quantity,
      selections: Object.fromEntries(Object.entries(selectedValues).map(([key, value]) => [key, String(value)])),
      billableComponents,
      includedComponents,
    });
  }
  for (const [itemId, required] of requiredBillable) {
    const billed = Number(billedQuantities.get(itemId) || 0);
    if (billed < required) {
      const item = [...stock.values()].find((row) => Number(row.id) === itemId);
      throw Object.assign(new Error(`${item?.item_name || 'A charged medicine'} must have quantity ${required} for the selected treatment template.`), {
        status: 400,
        extra: { code: "TREATMENT_TEMPLATE_BILLABLE_MISMATCH", inventory_item_id: itemId, required, billed },
      });
    }
  }
  return instances;
}

module.exports = {
  ROLE_CHOICES,
  adminTreatmentTemplatePayload,
  ensureTreatmentTemplateSchema,
  listTreatmentTemplates,
  resolveTreatmentTemplateSelections,
  saveTreatmentTemplate,
  treatmentTemplatesForDoctor,
};
