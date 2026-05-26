const express = require("express");
const { db } = require("../db");
const {
  describeValidCollectionDays,
  getWeekdayForIsoDate,
  isValidCollectionDate,
} = require("../lib/collectionDays");
const { sendPushToRole, sendPushToUser } = require("../lib/push");

const router = express.Router();

const MAX_ITEMS_PER_REQUEST = 25;
const MAX_QUANTITY_PER_LINE = 999;

function getDoctorIdForUser(userId) {
  if (!userId) return null;
  const row = db
    .prepare("SELECT doctor_id FROM users WHERE id = ? LIMIT 1")
    .get(userId);
  return row?.doctor_id ? Number(row.doctor_id) : null;
}

function getDoctorUserId(doctorId) {
  if (!doctorId) return null;
  const row = db
    .prepare(`
      SELECT id FROM users
      WHERE doctor_id = ?
        AND role = 'doctor'
        AND is_active = 1
        AND deleted_at IS NULL
      LIMIT 1
    `)
    .get(doctorId);
  return row?.id ? Number(row.id) : null;
}

function listRequests({ status, doctorId, requestId } = {}) {
  const filters = [];
  const params = {};
  if (requestId) {
    filters.push("r.id = @request_id");
    params.request_id = Number(requestId);
  }
  if (Array.isArray(status) && status.length) {
    filters.push(
      `r.status IN (${status.map((_, idx) => `@status_${idx}`).join(", ")})`,
    );
    status.forEach((value, idx) => {
      params[`status_${idx}`] = value;
    });
  }
  if (doctorId) {
    filters.push("r.doctor_id = @doctor_id");
    params.doctor_id = doctorId;
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const rows = db
    .prepare(`
      SELECT
        r.id,
        r.doctor_id,
        d.full_name AS doctor_name,
        r.collection_date,
        r.collection_day,
        r.status,
        r.note,
        r.created_at,
        r.updated_at,
        r.prepared_at,
        r.prepared_by_user_id,
        prep.full_name AS prepared_by_name,
        req.full_name AS requested_by_name
      FROM restock_requests r
      LEFT JOIN doctors d ON d.id = r.doctor_id
      LEFT JOIN users req ON req.id = r.requested_by_user_id
      LEFT JOIN users prep ON prep.id = r.prepared_by_user_id
      ${where}
      ORDER BY
        CASE r.status WHEN 'pending' THEN 0 WHEN 'prepared' THEN 1 ELSE 2 END,
        datetime(r.created_at) DESC
    `)
    .all(params);

  if (!rows.length) {
    return [];
  }

  const itemsByRequestId = new Map();
  const requestIds = rows.map((row) => row.id);
  const itemRows = db
    .prepare(`
      SELECT
        ri.id,
        ri.request_id,
        ri.inventory_id,
        ri.item_name,
        ri.quantity,
        inv.quantity AS inventory_quantity,
        inv.minimum_quantity AS inventory_par_level
      FROM restock_request_items ri
      LEFT JOIN inventory inv ON inv.id = ri.inventory_id
      WHERE ri.request_id IN (${requestIds.map(() => "?").join(", ")})
      ORDER BY ri.id ASC
    `)
    .all(...requestIds);

  for (const item of itemRows) {
    if (!itemsByRequestId.has(item.request_id)) {
      itemsByRequestId.set(item.request_id, []);
    }
    itemsByRequestId.get(item.request_id).push({
      id: item.id,
      inventory_id: item.inventory_id,
      item_name: item.item_name,
      quantity: Number(item.quantity || 0),
      inventory_quantity: item.inventory_quantity == null ? null : Number(item.inventory_quantity),
      inventory_par_level:
        item.inventory_par_level == null ? null : Number(item.inventory_par_level),
    });
  }

  return rows.map((row) => ({
    id: row.id,
    doctor_id: row.doctor_id,
    doctor_name: row.doctor_name || "Doctor",
    collection_date: row.collection_date,
    collection_day: Number(row.collection_day),
    status: row.status,
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    prepared_at: row.prepared_at,
    prepared_by_user_id: row.prepared_by_user_id,
    prepared_by_name: row.prepared_by_name || null,
    requested_by_name: row.requested_by_name || null,
    items: itemsByRequestId.get(row.id) || [],
  }));
}

function getRequestById(id) {
  const matches = listRequests({ requestId: Number(id) });
  return matches[0] || null;
}

function parseStatusFilter(rawStatus) {
  if (!rawStatus) return null;
  const allowed = new Set(["pending", "prepared", "cancelled"]);
  const values = String(rawStatus)
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => allowed.has(value));
  return values.length ? values : null;
}

function normaliseItemsPayload(rawItems) {
  if (!Array.isArray(rawItems)) {
    return { error: "Items list is required." };
  }
  if (!rawItems.length) {
    return { error: "Add at least one item to your supply request." };
  }
  if (rawItems.length > MAX_ITEMS_PER_REQUEST) {
    return { error: `You can request up to ${MAX_ITEMS_PER_REQUEST} items at a time.` };
  }

  const merged = new Map();
  for (const raw of rawItems) {
    const inventoryId = Number(raw?.inventory_id || 0) || null;
    const itemName = String(raw?.item_name || "").trim();
    const quantity = Math.floor(Number(raw?.quantity || 0));

    if (!itemName) {
      return { error: "Each requested item must have a name." };
    }
    if (!Number.isFinite(quantity) || quantity < 1) {
      return { error: `Quantity for ${itemName} must be at least 1.` };
    }
    if (quantity > MAX_QUANTITY_PER_LINE) {
      return { error: `Quantity for ${itemName} cannot exceed ${MAX_QUANTITY_PER_LINE}.` };
    }

    const key = inventoryId ? `inv:${inventoryId}` : `name:${itemName.toLowerCase()}`;
    if (merged.has(key)) {
      merged.get(key).quantity += quantity;
    } else {
      merged.set(key, {
        inventory_id: inventoryId,
        item_name: itemName,
        quantity,
      });
    }
  }

  return { items: Array.from(merged.values()) };
}

function loadPendingRequestForDoctor(requestId, userId) {
  const doctorId = getDoctorIdForUser(userId);
  if (!doctorId) {
    return { error: "Your account is not linked to a doctor profile.", status: 400 };
  }

  const row = db
    .prepare("SELECT id, doctor_id, status FROM restock_requests WHERE id = ? LIMIT 1")
    .get(Number(requestId));

  if (!row) {
    return { error: "Restock request not found.", status: 404 };
  }
  if (Number(row.doctor_id) !== doctorId) {
    return { error: "You can only change your own supply requests.", status: 403 };
  }
  if (row.status !== "pending") {
    return {
      error: "Only pending requests can be edited or cancelled. Prepared packs are locked.",
      status: 400,
    };
  }

  return { row, doctorId };
}

function replaceRequestItems(requestId, items) {
  db.prepare("DELETE FROM restock_request_items WHERE request_id = ?").run(requestId);
  const insertItem = db.prepare(`
    INSERT INTO restock_request_items (
      request_id,
      inventory_id,
      item_name,
      quantity
    )
    VALUES (?, ?, ?, ?)
  `);
  for (const item of items) {
    insertItem.run(requestId, item.inventory_id, item.item_name, item.quantity);
  }
}

router.get("/", (req, res) => {
  const auth = req.auth;
  const role = auth?.role;
  const statusFilter = parseStatusFilter(req.query.status);

  if (role === "doctor") {
    const doctorId = getDoctorIdForUser(auth.id);
    if (!doctorId) {
      return res.json({ requests: [] });
    }
    return res.json({
      requests: listRequests({ status: statusFilter, doctorId }),
    });
  }

  if (role === "operator" || role === "admin") {
    return res.json({
      requests: listRequests({ status: statusFilter }),
    });
  }

  return res.status(403).json({ error: "Not authorised to read restock requests." });
});

router.post("/", (req, res) => {
  if (req.auth?.role !== "doctor") {
    return res.status(403).json({ error: "Only doctors can submit restock requests." });
  }

  const doctorId = getDoctorIdForUser(req.auth.id);
  if (!doctorId) {
    return res.status(400).json({
      error: "Your account is not linked to a doctor profile. Contact admin to fix this.",
    });
  }

  const collectionDate = String(req.body?.collection_date || "").trim();
  if (!isValidCollectionDate(collectionDate)) {
    return res.status(400).json({
      error: `Collection date must be one of the available ${describeValidCollectionDays()}.`,
    });
  }

  const itemsPayload = normaliseItemsPayload(req.body?.items);
  if (itemsPayload.error) {
    return res.status(400).json({ error: itemsPayload.error });
  }

  const note = String(req.body?.note || "").trim().slice(0, 500);
  const collectionDay = getWeekdayForIsoDate(collectionDate);

  const insertRequest = db.prepare(`
    INSERT INTO restock_requests (
      doctor_id,
      requested_by_user_id,
      collection_date,
      collection_day,
      status,
      note
    )
    VALUES (?, ?, ?, ?, 'pending', ?)
  `);

  const insertItem = db.prepare(`
    INSERT INTO restock_request_items (
      request_id,
      inventory_id,
      item_name,
      quantity
    )
    VALUES (?, ?, ?, ?)
  `);

  const createRequest = db.transaction(() => {
    const info = insertRequest.run(
      doctorId,
      req.auth.id,
      collectionDate,
      collectionDay,
      note,
    );
    const requestId = Number(info.lastInsertRowid);
    for (const item of itemsPayload.items) {
      insertItem.run(requestId, item.inventory_id, item.item_name, item.quantity);
    }
    return requestId;
  });

  const newId = createRequest();
  const created = getRequestById(newId);

  void sendPushToRole("operator", {
    title: "📋 Restock Request",
    body: `Dr. ${created.doctor_name} requested ${created.items.length} item${
      created.items.length === 1 ? "" : "s"
    } for ${created.collection_date}.`,
    url: "/inventory",
    icon: "/icon-192.png",
    tag: `restock-request-${newId}`,
  }).catch((error) => {
    console.warn("[push] restock request operator notify failed:", error?.message || error);
  });

  return res.status(201).json({ request: created });
});

router.put("/:id", (req, res) => {
  if (req.auth?.role !== "doctor") {
    return res.status(403).json({ error: "Only doctors can edit their supply requests." });
  }

  const requestId = Number(req.params.id);
  if (!requestId) {
    return res.status(400).json({ error: "Invalid restock request id." });
  }

  const access = loadPendingRequestForDoctor(requestId, req.auth.id);
  if (access.error) {
    return res.status(access.status).json({ error: access.error });
  }

  const collectionDate = String(req.body?.collection_date || "").trim();
  if (!isValidCollectionDate(collectionDate)) {
    return res.status(400).json({
      error: `Collection date must be one of the available ${describeValidCollectionDays()}.`,
    });
  }

  const itemsPayload = normaliseItemsPayload(req.body?.items);
  if (itemsPayload.error) {
    return res.status(400).json({ error: itemsPayload.error });
  }

  const note = String(req.body?.note || "").trim().slice(0, 500);
  const collectionDay = getWeekdayForIsoDate(collectionDate);

  db.transaction(() => {
    db.prepare(`
      UPDATE restock_requests
      SET
        collection_date = ?,
        collection_day = ?,
        note = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(collectionDate, collectionDay, note, requestId);
    replaceRequestItems(requestId, itemsPayload.items);
  })();

  const updated = getRequestById(requestId);

  void sendPushToRole("operator", {
    title: "📋 Supply Request Updated",
    body: `Dr. ${updated.doctor_name} revised a pending request for ${updated.collection_date}.`,
    url: "/inventory",
    icon: "/icon-192.png",
    tag: `restock-request-${requestId}-updated`,
  }).catch((error) => {
    console.warn("[push] restock request update notify failed:", error?.message || error);
  });

  return res.json({ request: updated });
});

router.patch("/:id", (req, res) => {
  const role = req.auth?.role;
  const requestId = Number(req.params.id);
  if (!requestId) {
    return res.status(400).json({ error: "Invalid restock request id." });
  }

  const nextStatus = String(req.body?.status || "").trim().toLowerCase();

  if (role === "doctor") {
    if (nextStatus !== "cancelled") {
      return res.status(400).json({
        error: "Doctors can only cancel a pending request. Use PUT to edit items or collection day.",
      });
    }

    const access = loadPendingRequestForDoctor(requestId, req.auth.id);
    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    db.prepare(`
      UPDATE restock_requests
      SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(requestId);

    return res.json({ request: getRequestById(requestId) });
  }

  if (role !== "operator" && role !== "admin") {
    return res.status(403).json({ error: "Only operators or admins can update restock requests." });
  }

  const existing = db
    .prepare("SELECT id, doctor_id, status FROM restock_requests WHERE id = ? LIMIT 1")
    .get(requestId);

  if (!existing) {
    return res.status(404).json({ error: "Restock request not found." });
  }

  if (!["prepared", "cancelled"].includes(nextStatus)) {
    return res.status(400).json({ error: "Status must be 'prepared' or 'cancelled'." });
  }

  if (existing.status === nextStatus) {
    return res.json({ request: getRequestById(requestId) });
  }

  db.prepare(`
    UPDATE restock_requests
    SET
      status = ?,
      prepared_at = CASE WHEN ? = 'prepared' THEN CURRENT_TIMESTAMP ELSE prepared_at END,
      prepared_by_user_id = CASE WHEN ? = 'prepared' THEN ? ELSE prepared_by_user_id END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(nextStatus, nextStatus, nextStatus, req.auth.id, requestId);

  const updated = getRequestById(requestId);

  if (nextStatus === "prepared") {
    const doctorUserId = getDoctorUserId(updated.doctor_id);
    if (doctorUserId) {
      void sendPushToUser(doctorUserId, {
        title: "✅ Supplies Ready for Collection",
        body: `Your restock request is prepared. Pick it up on ${updated.collection_date}.`,
        url: "/supply-requests",
        icon: "/icon-192.png",
        tag: `restock-request-${requestId}-prepared`,
      }).catch((error) => {
        console.warn("[push] restock request doctor notify failed:", error?.message || error);
      });
    }
  }

  return res.json({ request: updated });
});

router.delete("/:id", (req, res) => {
  const role = req.auth?.role;
  if (role !== "operator" && role !== "admin") {
    return res.status(403).json({ error: "Only operators or admins can delete restock requests." });
  }

  const requestId = Number(req.params.id);
  if (!requestId) {
    return res.status(400).json({ error: "Invalid restock request id." });
  }

  const existing = db
    .prepare("SELECT id FROM restock_requests WHERE id = ? LIMIT 1")
    .get(requestId);

  if (!existing) {
    return res.status(404).json({ error: "Restock request not found." });
  }

  db.prepare("DELETE FROM restock_requests WHERE id = ?").run(requestId);

  return res.json({ ok: true });
});

module.exports = router;
