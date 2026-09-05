const express = require("express");
const { db } = require("../db");
const {
  describeValidCollectionDays,
  getWeekdayForIsoDate,
  isValidCollectionDate,
} = require("../lib/collectionDays");
const { publishSupplyRequestChange } = require("../lib/inventoryRealtime");
const { sendPushToRole, sendPushToUser } = require("../lib/push");
const {
  ACTIVE_STATUSES,
  ALL_STATUSES,
  EVENT_TYPES,
  HISTORY_STATUSES,
  actorFromAuth,
  canTransition,
  isActiveStatus,
  normaliseStatus,
  parseMetadata,
  snapshotItems,
  supplyRequestStatusLabel,
} = require("../lib/restockRequestWorkflow");

function broadcastSupplyRequestChange(doctorId) {
  try {
    publishSupplyRequestChange({ doctorId });
  } catch {
    // SSE fan-out is best-effort.
  }
}

const router = express.Router();

const MAX_ITEMS_PER_REQUEST = 25;
const MAX_QUANTITY_PER_LINE = 999;
const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;

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

function nowSql() {
  return db.prepare("SELECT CURRENT_TIMESTAMP AS now").get().now;
}

function recordEvent({
  requestId,
  eventType,
  previousStatus = null,
  newStatus = null,
  actor,
  reason = null,
  metadata = {},
}) {
  db.prepare(`
    INSERT INTO restock_request_events (
      request_id,
      event_type,
      previous_status,
      new_status,
      actor_user_id,
      actor_role,
      actor_display_name,
      reason,
      metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(requestId),
    eventType,
    previousStatus || null,
    newStatus || null,
    actor?.userId || null,
    actor?.role || null,
    actor?.displayName || null,
    reason ? String(reason).slice(0, 500) : null,
    JSON.stringify(metadata || {}),
  );
}

function listEventsForRequestIds(requestIds) {
  if (!requestIds.length) return new Map();
  const rows = db
    .prepare(`
      SELECT
        id,
        request_id,
        event_type,
        previous_status,
        new_status,
        actor_user_id,
        actor_role,
        actor_display_name,
        reason,
        metadata_json,
        created_at
      FROM restock_request_events
      WHERE request_id IN (${requestIds.map(() => "?").join(", ")})
      ORDER BY id ASC
    `)
    .all(...requestIds);

  const byRequest = new Map();
  for (const row of rows) {
    if (!byRequest.has(row.request_id)) byRequest.set(row.request_id, []);
    byRequest.get(row.request_id).push({
      id: row.id,
      event_type: row.event_type,
      previous_status: row.previous_status,
      new_status: row.new_status,
      actor_user_id: row.actor_user_id,
      actor_role: row.actor_role,
      actor_display_name: row.actor_display_name,
      reason: row.reason,
      metadata: parseMetadata(row.metadata_json),
      created_at: row.created_at,
    });
  }
  return byRequest;
}

function listAmendmentsForRequestIds(requestIds) {
  if (!requestIds.length) {
    return { pendingByRequest: new Map(), latestByRequest: new Map() };
  }

  const rows = db
    .prepare(`
      SELECT
        a.id,
        a.request_id,
        a.status,
        a.proposed_collection_date,
        a.proposed_collection_day,
        a.proposed_note,
        a.submitted_by_user_id,
        a.submitted_at,
        a.reviewed_by_user_id,
        a.reviewed_at,
        a.review_reason,
        submitter.full_name AS submitted_by_name,
        reviewer.full_name AS reviewed_by_name
      FROM restock_request_amendments a
      LEFT JOIN users submitter ON submitter.id = a.submitted_by_user_id
      LEFT JOIN users reviewer ON reviewer.id = a.reviewed_by_user_id
      WHERE a.request_id IN (${requestIds.map(() => "?").join(", ")})
      ORDER BY a.id DESC
    `)
    .all(...requestIds);

  const amendmentIds = rows.map((row) => row.id);
  const itemsByAmendment = new Map();
  if (amendmentIds.length) {
    const itemRows = db
      .prepare(`
        SELECT amendment_id, inventory_id, item_name, quantity
        FROM restock_request_amendment_items
        WHERE amendment_id IN (${amendmentIds.map(() => "?").join(", ")})
        ORDER BY id ASC
      `)
      .all(...amendmentIds);
    for (const item of itemRows) {
      if (!itemsByAmendment.has(item.amendment_id)) {
        itemsByAmendment.set(item.amendment_id, []);
      }
      itemsByAmendment.get(item.amendment_id).push({
        inventory_id: item.inventory_id,
        item_name: item.item_name,
        quantity: Number(item.quantity || 0),
      });
    }
  }

  const pendingByRequest = new Map();
  const latestByRequest = new Map();
  const historyByRequest = new Map();

  for (const row of rows) {
    const amendment = {
      id: row.id,
      request_id: row.request_id,
      status: row.status,
      proposed_collection_date: row.proposed_collection_date,
      proposed_collection_day: Number(row.proposed_collection_day),
      proposed_note: row.proposed_note,
      submitted_by_user_id: row.submitted_by_user_id,
      submitted_by_name: row.submitted_by_name || null,
      submitted_at: row.submitted_at,
      reviewed_by_user_id: row.reviewed_by_user_id,
      reviewed_by_name: row.reviewed_by_name || null,
      reviewed_at: row.reviewed_at,
      review_reason: row.review_reason || "",
      items: itemsByAmendment.get(row.id) || [],
    };

    if (!historyByRequest.has(row.request_id)) {
      historyByRequest.set(row.request_id, []);
    }
    historyByRequest.get(row.request_id).push(amendment);

    if (!latestByRequest.has(row.request_id)) {
      latestByRequest.set(row.request_id, amendment);
    }
    if (row.status === "pending" && !pendingByRequest.has(row.request_id)) {
      pendingByRequest.set(row.request_id, amendment);
    }
  }

  return { pendingByRequest, latestByRequest, historyByRequest };
}

function serializeRequest(row, extras = {}) {
  const status = normaliseStatus(row.status);
  return {
    id: row.id,
    doctor_id: row.doctor_id,
    doctor_name: row.doctor_name || "Doctor",
    collection_date: row.collection_date,
    collection_day: Number(row.collection_day),
    status,
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    accepted_at: row.accepted_at,
    accepted_by_user_id: row.accepted_by_user_id,
    accepted_by_name: row.accepted_by_name || null,
    ready_at: row.ready_at,
    ready_by_user_id: row.ready_by_user_id,
    ready_by_name: row.ready_by_name || null,
    prepared_at: row.ready_at,
    prepared_by_user_id: row.ready_by_user_id,
    prepared_by_name: row.ready_by_name || null,
    completed_at: row.completed_at,
    completed_by_user_id: row.completed_by_user_id,
    completed_by_name: row.completed_by_name || null,
    cancelled_at: row.cancelled_at,
    cancelled_by_user_id: row.cancelled_by_user_id,
    cancelled_by_name: row.cancelled_by_name || null,
    cancelled_reason: row.cancelled_reason || "",
    archived_at: row.archived_at,
    requested_by_name: row.requested_by_name || null,
    items: extras.items || [],
    pending_amendment: extras.pendingAmendment || null,
    latest_amendment: extras.latestAmendment || null,
    amendments: extras.amendments || [],
    events: extras.events || [],
    status_labels: {
      doctor: supplyRequestStatusLabel(status, "doctor"),
      operator: supplyRequestStatusLabel(status, "operator"),
      admin: supplyRequestStatusLabel(status, "admin"),
    },
  };
}

function listRequests({
  status,
  doctorId,
  requestId,
  from,
  to,
  itemSearch,
  limit,
  offset,
  includeEvents = false,
} = {}) {
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
  if (from) {
    filters.push("date(r.created_at) >= date(@from_date)");
    params.from_date = from;
  }
  if (to) {
    filters.push("date(r.created_at) <= date(@to_date)");
    params.to_date = to;
  }
  if (itemSearch) {
    filters.push(`
      EXISTS (
        SELECT 1 FROM restock_request_items ri_search
        WHERE ri_search.request_id = r.id
          AND LOWER(ri_search.item_name) LIKE @item_search
      )
    `);
    params.item_search = `%${itemSearch.toLowerCase()}%`;
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const boundedLimit = Number.isFinite(limit) ? limit : null;
  const boundedOffset = Number.isFinite(offset) ? offset : 0;
  const paging = boundedLimit != null
    ? "LIMIT @page_limit OFFSET @page_offset"
    : "";
  if (boundedLimit != null) {
    params.page_limit = boundedLimit;
    params.page_offset = boundedOffset;
  }

  const total = Number(
    db.prepare(`SELECT COUNT(*) AS count FROM restock_requests r ${where}`).get(params).count || 0,
  );

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
        r.accepted_at,
        r.accepted_by_user_id,
        accepted.full_name AS accepted_by_name,
        r.ready_at,
        r.ready_by_user_id,
        ready.full_name AS ready_by_name,
        r.completed_at,
        r.completed_by_user_id,
        completed.full_name AS completed_by_name,
        r.cancelled_at,
        r.cancelled_by_user_id,
        cancelled.full_name AS cancelled_by_name,
        r.cancelled_reason,
        r.archived_at,
        req.full_name AS requested_by_name
      FROM restock_requests r
      LEFT JOIN doctors d ON d.id = r.doctor_id
      LEFT JOIN users req ON req.id = r.requested_by_user_id
      LEFT JOIN users accepted ON accepted.id = r.accepted_by_user_id
      LEFT JOIN users ready ON ready.id = r.ready_by_user_id
      LEFT JOIN users completed ON completed.id = r.completed_by_user_id
      LEFT JOIN users cancelled ON cancelled.id = r.cancelled_by_user_id
      ${where}
      ORDER BY
        CASE r.status
          WHEN 'pending' THEN 0
          WHEN 'accepted' THEN 1
          WHEN 'ready' THEN 2
          WHEN 'completed' THEN 3
          ELSE 4
        END,
        datetime(r.created_at) DESC
      ${paging}
    `)
    .all(params);

  if (!rows.length) {
    return { requests: [], total };
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

  const amendmentMaps = listAmendmentsForRequestIds(requestIds);
  const eventsByRequest = includeEvents ? listEventsForRequestIds(requestIds) : new Map();

  return {
    total,
    requests: rows.map((row) =>
      serializeRequest(row, {
        items: itemsByRequestId.get(row.id) || [],
        pendingAmendment: amendmentMaps.pendingByRequest.get(row.id) || null,
        latestAmendment: amendmentMaps.latestByRequest.get(row.id) || null,
        amendments: amendmentMaps.historyByRequest.get(row.id) || [],
        events: eventsByRequest.get(row.id) || [],
      }),
    ),
  };
}

function getRequestById(id, { includeEvents = true } = {}) {
  const matches = listRequests({ requestId: Number(id), includeEvents });
  return matches.requests[0] || null;
}

function parseStatusFilter(rawStatus) {
  if (!rawStatus) return null;
  const allowed = new Set([...ALL_STATUSES, "prepared"]);
  const values = String(rawStatus)
    .split(",")
    .map((value) => normaliseStatus(value))
    .filter((value) => allowed.has(value) && value !== "prepared");
  return values.length ? [...new Set(values)] : null;
}

function parseIsoDateQuery(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function historyStats({ doctorId, status, from, to, itemSearch } = {}) {
  const filters = ["r.status IN ('completed', 'cancelled')"];
  const params = {};
  if (doctorId) {
    filters.push("r.doctor_id = @doctor_id");
    params.doctor_id = doctorId;
  }
  if (Array.isArray(status) && status.length) {
    filters.push(
      `r.status IN (${status.map((_, idx) => `@status_${idx}`).join(", ")})`,
    );
    status.forEach((value, idx) => {
      params[`status_${idx}`] = value;
    });
  }
  if (from) {
    filters.push("date(r.created_at) >= date(@from_date)");
    params.from_date = from;
  }
  if (to) {
    filters.push("date(r.created_at) <= date(@to_date)");
    params.to_date = to;
  }
  if (itemSearch) {
    filters.push(`
      EXISTS (
        SELECT 1 FROM restock_request_items ri_search
        WHERE ri_search.request_id = r.id
          AND LOWER(ri_search.item_name) LIKE @item_search
      )
    `);
    params.item_search = `%${itemSearch.toLowerCase()}%`;
  }
  const where = `WHERE ${filters.join(" AND ")}`;

  const doctorCounts = db
    .prepare(`
      SELECT
        r.doctor_id,
        d.full_name AS doctor_name,
        COUNT(*) AS request_count
      FROM restock_requests r
      LEFT JOIN doctors d ON d.id = r.doctor_id
      ${where}
      GROUP BY r.doctor_id, d.full_name
      ORDER BY request_count DESC, d.full_name ASC
    `)
    .all(params)
    .map((row) => ({
      doctor_id: row.doctor_id,
      doctor_name: row.doctor_name || "Doctor",
      request_count: Number(row.request_count || 0),
    }));

  const itemCounts = db
    .prepare(`
      SELECT
        ri.item_name,
        COUNT(DISTINCT ri.request_id) AS request_count,
        SUM(ri.quantity) AS total_quantity
      FROM restock_request_items ri
      JOIN restock_requests r ON r.id = ri.request_id
      ${where}
      GROUP BY ri.item_name
      ORDER BY request_count DESC, ri.item_name ASC
      LIMIT 50
    `)
    .all(params)
    .map((row) => ({
      item_name: row.item_name,
      request_count: Number(row.request_count || 0),
      total_quantity: Number(row.total_quantity || 0),
    }));

  return { doctor_counts: doctorCounts, item_counts: itemCounts };
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

function loadOwnedDoctorRequest(requestId, userId, { allowedStatuses } = {}) {
  const doctorId = getDoctorIdForUser(userId);
  if (!doctorId) {
    return { error: "Your account is not linked to a doctor profile.", status: 400 };
  }

  const row = db
    .prepare("SELECT * FROM restock_requests WHERE id = ? LIMIT 1")
    .get(Number(requestId));

  if (!row) {
    return { error: "Supply request not found.", status: 404 };
  }
  if (Number(row.doctor_id) !== doctorId) {
    return { error: "You can only change your own supply requests.", status: 403 };
  }
  if (allowedStatuses && !allowedStatuses.includes(row.status)) {
    return {
      error: "This supply request can no longer be changed.",
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

function pendingAmendmentFor(requestId) {
  return db
    .prepare(`
      SELECT * FROM restock_request_amendments
      WHERE request_id = ? AND status = 'pending'
      LIMIT 1
    `)
    .get(Number(requestId));
}

function notifyBestEffort(fn, label) {
  void fn().catch((error) => {
    console.warn(`[push] ${label}:`, error?.message || error);
  });
}

router.get("/", (req, res) => {
  const auth = req.auth;
  const role = auth?.role;
  const view = String(req.query.view || "").trim().toLowerCase();
  const statusFilter = parseStatusFilter(req.query.status);
  const itemSearch = String(req.query.item || req.query.q || "").trim();
  const from = parseIsoDateQuery(req.query.from);
  const to = parseIsoDateQuery(req.query.to);
  const requestedDoctorId = Number(req.query.doctor_id || 0) || null;
  const includeEvents = view === "history" || String(req.query.include_events || "") === "1";
  const usePaging = view === "history";
  const limit = usePaging
    ? Math.min(
        MAX_HISTORY_LIMIT,
        Math.max(1, Number(req.query.limit || DEFAULT_HISTORY_LIMIT) || DEFAULT_HISTORY_LIMIT),
      )
    : null;
  const offset = usePaging ? Math.max(0, Number(req.query.offset || 0) || 0) : null;

  let statuses = statusFilter;
  if (view === "history") {
    statuses = (statuses || HISTORY_STATUSES).filter((value) => HISTORY_STATUSES.includes(value));
    if (!statuses.length) statuses = HISTORY_STATUSES;
  } else if (view === "all") {
    statuses = statuses || ALL_STATUSES;
  } else {
    statuses = (statuses || ACTIVE_STATUSES).filter((value) => ACTIVE_STATUSES.includes(value));
    if (!statuses.length) statuses = ACTIVE_STATUSES;
  }

  const scopedDoctorId = role === "doctor" ? getDoctorIdForUser(auth.id) : requestedDoctorId;
  if (role === "doctor" && !scopedDoctorId) {
    return res.json({ requests: [], total: 0, doctor_counts: [], item_counts: [] });
  }

  if (role !== "doctor" && role !== "operator" && role !== "admin") {
    return res.status(403).json({ error: "Not authorised to read restock requests." });
  }

  const result = listRequests({
    status: statuses,
    doctorId: scopedDoctorId,
    from,
    to,
    itemSearch: itemSearch || null,
    limit,
    offset,
    includeEvents,
  });

  const payload = {
    requests: result.requests,
    total: result.total,
  };

  if (view === "history" && (role === "operator" || role === "admin")) {
    Object.assign(
      payload,
      historyStats({
        doctorId: scopedDoctorId,
        status: statuses.filter((value) => HISTORY_STATUSES.includes(value)),
        from,
        to,
        itemSearch: itemSearch || null,
      }),
    );
  }

  return res.json(payload);
});

router.get("/:id", (req, res) => {
  const requestId = Number(req.params.id);
  if (!requestId) {
    return res.status(400).json({ error: "Invalid restock request id." });
  }

  const request = getRequestById(requestId);
  if (!request) {
    return res.status(404).json({ error: "Supply request not found." });
  }

  if (req.auth?.role === "doctor") {
    const doctorId = getDoctorIdForUser(req.auth.id);
    if (Number(request.doctor_id) !== Number(doctorId)) {
      return res.status(403).json({ error: "You can only view your own supply requests." });
    }
  } else if (req.auth?.role !== "operator" && req.auth?.role !== "admin") {
    return res.status(403).json({ error: "Not authorised to read restock requests." });
  }

  return res.json({ request });
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
  const actor = actorFromAuth(req.auth);

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
    recordEvent({
      requestId,
      eventType: EVENT_TYPES.created,
      previousStatus: null,
      newStatus: "pending",
      actor,
      metadata: {
        collection_date: collectionDate,
        note,
        items: snapshotItems(itemsPayload.items),
      },
    });
    return requestId;
  });

  const newId = createRequest();
  const created = getRequestById(newId);

  notifyBestEffort(
    () =>
      sendPushToRole("operator", {
        title: "📋 Restock Request",
        body: `Dr. ${created.doctor_name} requested ${created.items.length} item${
          created.items.length === 1 ? "" : "s"
        } for ${created.collection_date}.`,
        url: "/inventory",
        icon: "/icon-192.png",
        tag: `restock-request-${newId}`,
      }),
    "restock request operator notify failed",
  );

  broadcastSupplyRequestChange(doctorId);

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

  const access = loadOwnedDoctorRequest(requestId, req.auth.id, {
    allowedStatuses: ["pending"],
  });
  if (access.error) {
    if (access.row && access.row.status !== "pending") {
      return res.status(400).json({
        error: "Accepted and later requests cannot be edited directly. Submit a change request while the request is accepted, or wait until a new request is needed.",
      });
    }
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
  const actor = actorFromAuth(req.auth);

  db.transaction(() => {
    const updated = db.prepare(`
      UPDATE restock_requests
      SET
        collection_date = ?,
        collection_day = ?,
        note = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).run(collectionDate, collectionDay, note, requestId);
    if (!updated.changes) {
      throw Object.assign(new Error("Only pending requests can be edited."), { status: 400 });
    }
    replaceRequestItems(requestId, itemsPayload.items);
    recordEvent({
      requestId,
      eventType: EVENT_TYPES.edited,
      previousStatus: "pending",
      newStatus: "pending",
      actor,
      metadata: {
        collection_date: collectionDate,
        note,
        items: snapshotItems(itemsPayload.items),
      },
    });
  })();

  const updated = getRequestById(requestId);

  notifyBestEffort(
    () =>
      sendPushToRole("operator", {
        title: "📋 Supply Request Updated",
        body: `Dr. ${updated.doctor_name} revised a pending request for ${updated.collection_date}.`,
        url: "/inventory",
        icon: "/icon-192.png",
        tag: `restock-request-${requestId}-updated`,
      }),
    "restock request update notify failed",
  );

  broadcastSupplyRequestChange(updated.doctor_id);

  return res.json({ request: updated });
});

router.post("/:id/amendments", (req, res) => {
  if (req.auth?.role !== "doctor") {
    return res.status(403).json({ error: "Only doctors can request changes to an accepted supply request." });
  }

  const requestId = Number(req.params.id);
  if (!requestId) {
    return res.status(400).json({ error: "Invalid restock request id." });
  }

  const access = loadOwnedDoctorRequest(requestId, req.auth.id);
  if (access.error) {
    return res.status(access.status).json({ error: access.error });
  }
  if (access.row.status !== "accepted") {
    return res.status(400).json({
      error:
        access.row.status === "ready"
          ? "Changes cannot be requested after the supply is marked ready."
          : "Change requests can only be submitted while the request is accepted.",
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
  const actor = actorFromAuth(req.auth);

  let amendmentId;
  try {
    amendmentId = db.transaction(() => {
      const locked = db
        .prepare("SELECT id, status FROM restock_requests WHERE id = ?")
        .get(requestId);
      if (!locked || locked.status !== "accepted") {
        throw Object.assign(new Error("Change requests can only be submitted while the request is accepted."), {
          status: 400,
        });
      }
      if (pendingAmendmentFor(requestId)) {
        throw Object.assign(new Error("A change request is already awaiting operator review."), {
          status: 409,
        });
      }

      const info = db.prepare(`
        INSERT INTO restock_request_amendments (
          request_id,
          status,
          proposed_collection_date,
          proposed_collection_day,
          proposed_note,
          submitted_by_user_id
        )
        VALUES (?, 'pending', ?, ?, ?, ?)
      `).run(requestId, collectionDate, collectionDay, note, req.auth.id);

      const newAmendmentId = Number(info.lastInsertRowid);
      const insertItem = db.prepare(`
        INSERT INTO restock_request_amendment_items (
          amendment_id,
          inventory_id,
          item_name,
          quantity
        )
        VALUES (?, ?, ?, ?)
      `);
      for (const item of itemsPayload.items) {
        insertItem.run(newAmendmentId, item.inventory_id, item.item_name, item.quantity);
      }

      db.prepare(`
        UPDATE restock_requests SET updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(requestId);

      recordEvent({
        requestId,
        eventType: EVENT_TYPES.amendmentSubmitted,
        previousStatus: "accepted",
        newStatus: "accepted",
        actor,
        metadata: {
          amendment_id: newAmendmentId,
          proposed_collection_date: collectionDate,
          proposed_note: note,
          proposed_items: snapshotItems(itemsPayload.items),
        },
      });

      return newAmendmentId;
    })();
  } catch (error) {
    if (String(error?.message || "").includes("idx_restock_amendments_one_pending")) {
      return res.status(409).json({ error: "A change request is already awaiting operator review." });
    }
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }

  const updated = getRequestById(requestId);

  notifyBestEffort(
    () =>
      sendPushToRole("operator", {
        title: "Change Requested",
        body: `Dr. ${updated.doctor_name} requested changes to an accepted supply request.`,
        url: "/inventory",
        icon: "/icon-192.png",
        tag: `restock-request-${requestId}-amendment-${amendmentId}`,
      }),
    "restock amendment operator notify failed",
  );

  broadcastSupplyRequestChange(updated.doctor_id);

  return res.status(201).json({ request: updated, amendment: updated.pending_amendment });
});

router.patch("/:id/amendments/:amendmentId", (req, res) => {
  const role = req.auth?.role;
  if (role !== "operator" && role !== "admin") {
    return res.status(403).json({ error: "Only operators or admins can review change requests." });
  }

  const requestId = Number(req.params.id);
  const amendmentId = Number(req.params.amendmentId);
  if (!requestId || !amendmentId) {
    return res.status(400).json({ error: "Invalid restock request or amendment id." });
  }

  const decision = String(req.body?.decision || req.body?.status || "").trim().toLowerCase();
  if (!["accepted", "rejected"].includes(decision)) {
    return res.status(400).json({ error: "Decision must be 'accepted' or 'rejected'." });
  }
  const reason = String(req.body?.reason || req.body?.review_reason || "").trim().slice(0, 500);
  const actor = actorFromAuth(req.auth);

  try {
    db.transaction(() => {
      const request = db
        .prepare("SELECT * FROM restock_requests WHERE id = ? LIMIT 1")
        .get(requestId);
      if (!request) {
        throw Object.assign(new Error("Supply request not found."), { status: 404 });
      }
      if (request.status !== "accepted") {
        throw Object.assign(new Error("Change requests can only be reviewed while the request is accepted."), {
          status: 400,
        });
      }

      const amendment = db
        .prepare(`
          SELECT * FROM restock_request_amendments
          WHERE id = ? AND request_id = ?
          LIMIT 1
        `)
        .get(amendmentId, requestId);
      if (!amendment) {
        throw Object.assign(new Error("Change request not found."), { status: 404 });
      }
      if (amendment.status !== "pending") {
        throw Object.assign(new Error("This change request has already been reviewed."), { status: 409 });
      }

      const proposedItems = db
        .prepare(`
          SELECT inventory_id, item_name, quantity
          FROM restock_request_amendment_items
          WHERE amendment_id = ?
          ORDER BY id ASC
        `)
        .all(amendmentId);

      const currentItems = db
        .prepare(`
          SELECT inventory_id, item_name, quantity
          FROM restock_request_items
          WHERE request_id = ?
          ORDER BY id ASC
        `)
        .all(requestId);

      db.prepare(`
        UPDATE restock_request_amendments
        SET
          status = ?,
          reviewed_by_user_id = ?,
          reviewed_at = CURRENT_TIMESTAMP,
          review_reason = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending'
      `).run(decision, req.auth.id, reason, amendmentId);

      if (decision === "accepted") {
        db.prepare(`
          UPDATE restock_requests
          SET
            collection_date = ?,
            collection_day = ?,
            note = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'accepted'
        `).run(
          amendment.proposed_collection_date,
          amendment.proposed_collection_day,
          amendment.proposed_note,
          requestId,
        );
        replaceRequestItems(requestId, proposedItems);
      }

      recordEvent({
        requestId,
        eventType: decision === "accepted" ? EVENT_TYPES.amendmentAccepted : EVENT_TYPES.amendmentRejected,
        previousStatus: "accepted",
        newStatus: "accepted",
        actor,
        reason,
        metadata: {
          amendment_id: amendmentId,
          previous: {
            collection_date: request.collection_date,
            note: request.note,
            items: snapshotItems(currentItems),
          },
          proposed: {
            collection_date: amendment.proposed_collection_date,
            note: amendment.proposed_note,
            items: snapshotItems(proposedItems),
          },
        },
      });
    })();
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }

  const updated = getRequestById(requestId);
  const doctorUserId = getDoctorUserId(updated.doctor_id);
  if (doctorUserId) {
    notifyBestEffort(
      () =>
        sendPushToUser(doctorUserId, {
          title: decision === "accepted" ? "Change Request Accepted" : "Change Request Declined",
          body:
            decision === "accepted"
              ? "Your proposed supply request changes were accepted."
              : reason
                ? `Your proposed changes were declined: ${reason}`
                : "Your proposed supply request changes were declined.",
          url: "/supply-requests",
          icon: "/icon-192.png",
          tag: `restock-request-${requestId}-amendment-${decision}`,
        }),
      "restock amendment doctor notify failed",
    );
  }

  broadcastSupplyRequestChange(updated.doctor_id);
  return res.json({ request: updated });
});

router.patch("/:id", (req, res) => {
  const role = req.auth?.role;
  const requestId = Number(req.params.id);
  if (!requestId) {
    return res.status(400).json({ error: "Invalid restock request id." });
  }

  const nextStatus = normaliseStatus(req.body?.status);
  const reason = String(req.body?.reason || req.body?.cancelled_reason || "").trim().slice(0, 500);
  const actor = actorFromAuth(req.auth);

  const existing = db
    .prepare("SELECT * FROM restock_requests WHERE id = ? LIMIT 1")
    .get(requestId);
  if (!existing) {
    return res.status(404).json({ error: "Supply request not found." });
  }

  if (existing.status === nextStatus) {
    return res.json({ request: getRequestById(requestId) });
  }

  if (role === "doctor") {
    const doctorId = getDoctorIdForUser(req.auth.id);
    if (Number(existing.doctor_id) !== Number(doctorId)) {
      return res.status(403).json({ error: "You can only change your own supply requests." });
    }
    if (!canTransition("doctor", existing.status, nextStatus)) {
      if (nextStatus === "cancelled") {
        return res.status(400).json({
          error: "You can only cancel a request while it is still requested.",
        });
      }
      if (nextStatus === "completed") {
        return res.status(400).json({
          error: "You can confirm collection only after the supply is marked ready.",
        });
      }
      return res.status(400).json({
        error: "Doctors can cancel a pending request or confirm collection of a ready request.",
      });
    }
  } else if (role === "operator" || role === "admin") {
    if (!canTransition(role, existing.status, nextStatus)) {
      return res.status(400).json({
        error: "That status change is not allowed for this supply request.",
      });
    }
    if (nextStatus === "cancelled" && !reason) {
      return res.status(400).json({
        error: "A cancellation reason is required. The request will be archived, not deleted.",
      });
    }
    if (nextStatus === "ready" && pendingAmendmentFor(requestId)) {
      return res.status(400).json({
        error: "Review the pending change request before marking the supply ready.",
      });
    }
  } else {
    return res.status(403).json({ error: "Only operators, admins, or the requesting doctor can update restock requests." });
  }

  const timestamp = nowSql();

  try {
    db.transaction(() => {
      const locked = db
        .prepare("SELECT * FROM restock_requests WHERE id = ? LIMIT 1")
        .get(requestId);
      if (!locked) {
        throw Object.assign(new Error("Supply request not found."), { status: 404 });
      }
      if (locked.status === nextStatus) {
        return;
      }
      if (role === "doctor" && !canTransition("doctor", locked.status, nextStatus)) {
        throw Object.assign(new Error("That status change is not allowed for this supply request."), {
          status: 409,
        });
      }
      if ((role === "operator" || role === "admin") && !canTransition(role, locked.status, nextStatus)) {
        throw Object.assign(new Error("That status change is not allowed for this supply request."), {
          status: 409,
        });
      }
      if (nextStatus === "ready" && pendingAmendmentFor(requestId)) {
        throw Object.assign(new Error("Review the pending change request before marking the supply ready."), {
          status: 400,
        });
      }

      let sql = `
        UPDATE restock_requests
        SET status = ?, updated_at = CURRENT_TIMESTAMP
      `;
      const params = [nextStatus];

      if (nextStatus === "accepted") {
        sql += `, accepted_at = ?, accepted_by_user_id = ?`;
        params.push(timestamp, req.auth.id);
      } else if (nextStatus === "ready") {
        sql += `, ready_at = ?, ready_by_user_id = ?`;
        params.push(timestamp, req.auth.id);
      } else if (nextStatus === "completed") {
        sql += `, completed_at = ?, completed_by_user_id = ?, archived_at = ?`;
        params.push(timestamp, req.auth.id, timestamp);
      } else if (nextStatus === "cancelled") {
        sql += `, cancelled_at = ?, cancelled_by_user_id = ?, cancelled_reason = ?, archived_at = ?`;
        params.push(timestamp, req.auth.id, reason, timestamp);
      }

      sql += ` WHERE id = ? AND status = ?`;
      params.push(requestId, locked.status);

      const result = db.prepare(sql).run(...params);
      if (!result.changes) {
        throw Object.assign(new Error("The supply request was updated by someone else. Refresh and try again."), {
          status: 409,
        });
      }

      const items = db
        .prepare("SELECT inventory_id, item_name, quantity FROM restock_request_items WHERE request_id = ?")
        .all(requestId);

      const eventType =
        nextStatus === "accepted"
          ? EVENT_TYPES.accepted
          : nextStatus === "ready"
            ? EVENT_TYPES.ready
            : nextStatus === "completed"
              ? EVENT_TYPES.completed
              : EVENT_TYPES.cancelled;

      recordEvent({
        requestId,
        eventType,
        previousStatus: locked.status,
        newStatus: nextStatus,
        actor,
        reason: nextStatus === "cancelled" ? reason : null,
        metadata: {
          collection_date: locked.collection_date,
          items: snapshotItems(items),
        },
      });
    })();
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }

  const updated = getRequestById(requestId);

  if (nextStatus === "accepted") {
    const doctorUserId = getDoctorUserId(updated.doctor_id);
    if (doctorUserId) {
      notifyBestEffort(
        () =>
          sendPushToUser(doctorUserId, {
            title: "Request Accepted",
            body: `Your supply request for ${updated.collection_date} has been accepted.`,
            url: "/supply-requests",
            icon: "/icon-192.png",
            tag: `restock-request-${requestId}-accepted`,
          }),
        "restock request accepted notify failed",
      );
    }
  }

  if (nextStatus === "ready") {
    const doctorUserId = getDoctorUserId(updated.doctor_id);
    if (doctorUserId) {
      notifyBestEffort(
        () =>
          sendPushToUser(doctorUserId, {
            title: "Supply Ready",
            body: `Your restock request is ready. Pick it up on ${updated.collection_date}.`,
            url: "/supply-requests",
            icon: "/icon-192.png",
            tag: `restock-request-${requestId}-ready`,
          }),
        "restock request doctor notify failed",
      );
    }
  }

  if (nextStatus === "completed") {
    notifyBestEffort(
      () =>
        sendPushToRole("operator", {
          title: "Supply Dispatched",
          body: `Dr. ${updated.doctor_name} confirmed collection for ${updated.collection_date}.`,
          url: "/inventory",
          icon: "/icon-192.png",
          tag: `restock-request-${requestId}-completed`,
        }),
      "restock request completed operator notify failed",
    );
  }

  broadcastSupplyRequestChange(updated.doctor_id);
  return res.json({ request: updated });
});

router.delete("/:id", (_req, res) => {
  return res.status(405).json({
    error: "Supply requests cannot be permanently deleted. Cancel and archive them instead.",
  });
});

module.exports = router;
module.exports.listRequests = listRequests;
module.exports.getRequestById = getRequestById;
