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
  supplyRequestEventLabel,
  supplyRequestStatusLabel,
} = require("../lib/restockRequestWorkflow");
const { movementIdsForTransaction } = require("../lib/inventoryOperations");
const { LEGACY_STAFF_LABEL, resolveAuditActor } = require("../lib/auditActor");
const { assertRoutineOperatorAction } = require("../lib/inventoryAccess");
const {
  HttpError,
  applyPicking,
  assertCanMarkReady,
  assignRequest,
  canonicaliseRequestItem,
  fulfilmentDetail,
  lockPackedFulfilment,
  postCollectionTransfer,
  productivityMetrics,
  reconcileLegacyFulfilment,
  releaseReservations,
  replaceReservationsForAmendment,
  reserveAcceptedRequest,
  resolveShortages,
  workQueues,
} = require("../lib/restockFulfilment");

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
      event_label: supplyRequestEventLabel(row.event_type),
      previous_status: row.previous_status,
      new_status: row.new_status,
      actor_user_id: row.actor_user_id,
      actor_role: row.actor_role,
      actor_display_name: resolveAuditActor({
        displayName: row.actor_display_name,
        userId: row.actor_user_id,
        required: true,
      }),
      reason: row.reason,
      metadata: parseMetadata(row.metadata_json),
      created_at: row.created_at,
    });
  }
  return byRequest;
}

function listAmendmentsForRequestIds(requestIds) {
  if (!requestIds.length) {
    return { pendingByRequest: new Map(), latestByRequest: new Map(), historyByRequest: new Map() };
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

function namedActor(displayName, userId, { required = false } = {}) {
  return resolveAuditActor({
    displayName,
    userId,
    required,
  });
}

function normalizeFulfilmentForDetail(fulfilment) {
  if (!fulfilment) return null;
  const items = (fulfilment.items || []).map((line) => {
    const allocations = line.allocations || line.picked_batches || line.batches || [];
    return {
      ...line,
      reserved_quantity: Number(line.reserved_quantity || 0),
      fulfilled_quantity: Number(line.fulfilled_quantity || 0),
      picked_quantity: Number(line.picked_quantity || 0),
      shortage_quantity: Number(line.shortage_quantity || 0),
      shortage_reason: line.shortage_reason || fulfilment.partial_reason || "",
      picked_batches: allocations.map((batch) => ({
        id: batch.id || null,
        batch_id: batch.batch_id || batch.id || null,
        expiry_date: batch.expiry_date || null,
        is_non_expiring: Boolean(batch.is_non_expiring),
        quantity: Number(batch.quantity || batch.quantity_picked || 0),
      })),
    };
  });
  return {
    ...fulfilment,
    items,
  };
}

function serializeRequest(row, extras = {}) {
  const status = normaliseStatus(row.status);
  const transferTransactionId = row.transfer_transaction_id || extras.transferTransactionId || extras.fulfilment?.transfer_transaction_id || null;
  const events = extras.events || [];
  const createdEvent = events.find((event) => event.event_type === EVENT_TYPES.created);
  const originalItems = createdEvent?.metadata?.items || extras.items || [];
  const movements = transferTransactionId ? movementIdsForTransaction(transferTransactionId) : [];
  const acceptedRequired = Boolean(row.accepted_at || row.accepted_by_user_id);
  const readyRequired = Boolean(row.ready_at || row.ready_by_user_id);
  const completedRequired = Boolean(row.completed_at || row.completed_by_user_id);
  const cancelledRequired = Boolean(row.cancelled_at || row.cancelled_by_user_id);
  const fulfilment = normalizeFulfilmentForDetail(extras.fulfilment || null);
  const hasFulfilmentLines = Boolean(fulfilment?.items?.length);
  const lifecycleHasFulfilment = ["accepted", "ready", "completed"].includes(status);
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
    accepted_by_name: namedActor(row.accepted_by_name, row.accepted_by_user_id, { required: acceptedRequired }),
    ready_at: row.ready_at,
    ready_by_user_id: row.ready_by_user_id,
    ready_by_name: namedActor(row.ready_by_name, row.ready_by_user_id, { required: readyRequired }),
    prepared_at: row.ready_at,
    prepared_by_user_id: row.ready_by_user_id,
    prepared_by_name: namedActor(row.prepared_by_name || row.ready_by_name, row.ready_by_user_id, { required: readyRequired }),
    completed_at: row.completed_at,
    completed_by_user_id: row.completed_by_user_id,
    completed_by_name: namedActor(row.completed_by_name, row.completed_by_user_id, { required: completedRequired }),
    cancelled_at: row.cancelled_at,
    cancelled_by_user_id: row.cancelled_by_user_id,
    cancelled_by_name: namedActor(row.cancelled_by_name, row.cancelled_by_user_id, { required: cancelledRequired }),
    cancelled_reason: row.cancelled_reason || "",
    archived_at: row.archived_at,
    requested_by_name: namedActor(row.requested_by_name, row.requested_by_user_id, { required: Boolean(row.created_at) }),
    assigned_to_user_id: row.assigned_to_user_id || null,
    assigned_to_name: namedActor(row.assigned_to_name, row.assigned_to_user_id),
    transfer_transaction_id: transferTransactionId,
    receipt_available: Boolean(transferTransactionId),
    receipt_applicable: status === "completed" || Boolean(transferTransactionId),
    movement_ids: movements.map((movement) => movement.id),
    movements,
    original_items: originalItems,
    partial_fulfilment_approved: Boolean(row.partial_fulfilment_approved),
    partial_fulfilment_reason: row.partial_fulfilment_reason || "",
    fulfilment,
    fulfilment_recorded: hasFulfilmentLines,
    fulfilment_expected: lifecycleHasFulfilment,
    timeline_available: events.length > 0,
    can_cancel: canTransition("operator", status, "cancelled") || canTransition("admin", status, "cancelled"),
    items: extras.items || [],
    pending_amendment: extras.pendingAmendment || null,
    latest_amendment: extras.latestAmendment || null,
    amendments: extras.amendments || [],
    events,
    timeline: events.map((event) => ({
      id: event.id,
      label: event.event_label || supplyRequestEventLabel(event.event_type),
      event_type: event.event_type,
      at: event.created_at,
      actor: event.actor_display_name || LEGACY_STAFF_LABEL,
      role: event.actor_role,
      reason: event.reason || "",
      status: event.new_status,
    })),
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
  operatorId,
  folderId,
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
  if (operatorId) {
    filters.push(`
      (
        r.accepted_by_user_id = @operator_id
        OR r.ready_by_user_id = @operator_id
        OR r.assigned_to_user_id = @operator_id
        OR r.completed_by_user_id = @operator_id
        OR r.cancelled_by_user_id = @operator_id
      )
    `);
    params.operator_id = Number(operatorId);
  }
  if (folderId) {
    filters.push(`
      EXISTS (
        SELECT 1
        FROM restock_request_items ri_folder
        JOIN inventory inv_folder ON inv_folder.id = ri_folder.inventory_id
        WHERE ri_folder.request_id = r.id
          AND inv_folder.folder_id = @folder_id
      )
    `);
    params.folder_id = Number(folderId);
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
        r.assigned_to_user_id,
        assigned.full_name AS assigned_to_name,
        r.transfer_transaction_id,
        r.partial_fulfilment_approved,
        r.partial_fulfilment_reason,
        r.requested_by_user_id,
        req.full_name AS requested_by_name
      FROM restock_requests r
      LEFT JOIN doctors d ON d.id = r.doctor_id
      LEFT JOIN users req ON req.id = r.requested_by_user_id
      LEFT JOIN users accepted ON accepted.id = r.accepted_by_user_id
      LEFT JOIN users ready ON ready.id = r.ready_by_user_id
      LEFT JOIN users completed ON completed.id = r.completed_by_user_id
      LEFT JOIN users cancelled ON cancelled.id = r.cancelled_by_user_id
      LEFT JOIN users assigned ON assigned.id = r.assigned_to_user_id
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
        fulfilment: fulfilmentDetail(row.id),
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

function historyStats({ doctorId, status, from, to, itemSearch, operatorId, folderId, requestId } = {}) {
  const filters = ["r.status IN ('completed', 'cancelled')"];
  const params = {};
  if (requestId) {
    filters.push("r.id = @request_id");
    params.request_id = Number(requestId);
  }
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
  if (operatorId) {
    filters.push(`
      (
        r.accepted_by_user_id = @operator_id
        OR r.ready_by_user_id = @operator_id
        OR r.assigned_to_user_id = @operator_id
        OR r.completed_by_user_id = @operator_id
        OR r.cancelled_by_user_id = @operator_id
      )
    `);
    params.operator_id = Number(operatorId);
  }
  if (folderId) {
    filters.push(`
      EXISTS (
        SELECT 1
        FROM restock_request_items ri_folder
        JOIN inventory inv_folder ON inv_folder.id = ri_folder.inventory_id
        WHERE ri_folder.request_id = r.id
          AND inv_folder.folder_id = @folder_id
      )
    `);
    params.folder_id = Number(folderId);
  }
  const where = `WHERE ${filters.join(" AND ")}`;

  const totals = db
    .prepare(`
      SELECT
        COUNT(*) AS request_count,
        SUM(CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count
      FROM restock_requests r
      ${where}
    `)
    .get(params);

  const doctorCounts = db
    .prepare(`
      SELECT
        r.doctor_id,
        d.full_name AS doctor_name,
        COUNT(*) AS request_count,
        SUM(CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count
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
      completed_count: Number(row.completed_count || 0),
      cancelled_count: Number(row.cancelled_count || 0),
    }));

  const itemCounts = db
    .prepare(`
      SELECT
        ri.item_name,
        COUNT(DISTINCT ri.request_id) AS request_count,
        SUM(ri.quantity) AS total_quantity,
        SUM(COALESCE(fi.fulfilled_quantity, 0)) AS total_fulfilled,
        SUM(COALESCE(fi.shortage_quantity, 0)) AS shortage_quantity
      FROM restock_request_items ri
      JOIN restock_requests r ON r.id = ri.request_id
      LEFT JOIN restock_request_fulfillments f
        ON f.request_id = r.id AND f.status IN ('posted', 'packed', 'picking', 'open')
      LEFT JOIN restock_request_fulfillment_items fi
        ON fi.fulfilment_id = f.id
       AND (
         (ri.inventory_id IS NOT NULL AND fi.inventory_id = ri.inventory_id)
         OR (ri.inventory_id IS NULL AND fi.item_name = ri.item_name)
       )
      ${where}
      GROUP BY ri.item_name
      ORDER BY request_count DESC, ri.item_name ASC
    `)
    .all(params)
    .map((row) => ({
      item_name: row.item_name,
      request_count: Number(row.request_count || 0),
      total_quantity: Number(row.total_quantity || 0),
      total_fulfilled: Number(row.total_fulfilled || 0),
      shortage_quantity: Number(row.shortage_quantity || 0),
    }));

  return {
    doctor_counts: doctorCounts,
    item_counts: itemCounts,
    completed_count: Number(totals?.completed_count || 0),
    cancelled_count: Number(totals?.cancelled_count || 0),
    request_count: Number(totals?.request_count || 0),
  };
}

function historyLookups() {
  const operators = db
    .prepare(
      `
      SELECT id, full_name, username, role
      FROM users
      WHERE is_active = 1
        AND deleted_at IS NULL
        AND role IN ('operator', 'admin')
      ORDER BY full_name COLLATE NOCASE ASC, username COLLATE NOCASE ASC
    `,
    )
    .all();
  const folders = db
    .prepare(
      `
      SELECT id, name
      FROM inventory_folders
      ORDER BY name COLLATE NOCASE ASC
    `,
    )
    .all();
  return { operators, folders };
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
    const inventoryId = Number(raw?.inventory_id || 0);
    const quantity = Math.floor(Number(raw?.quantity || 0));
    const canonical = canonicaliseRequestItem({
      inventory_id: inventoryId,
      item_name: raw?.item_name,
      quantity,
    });
    if (canonical.error) {
      return { error: canonical.error };
    }
    if (!Number.isFinite(canonical.quantity) || canonical.quantity < 1) {
      return { error: `Quantity for ${canonical.item_name} must be at least 1.` };
    }
    if (canonical.quantity > MAX_QUANTITY_PER_LINE) {
      return { error: `Quantity for ${canonical.item_name} cannot exceed ${MAX_QUANTITY_PER_LINE}.` };
    }

    const key = `inv:${canonical.inventory_id}`;
    if (merged.has(key)) {
      merged.get(key).quantity += canonical.quantity;
    } else {
      merged.set(key, {
        inventory_id: canonical.inventory_id,
        item_name: canonical.item_name,
        quantity: canonical.quantity,
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
  const requestId = Number(req.query.request_id || req.query.id || 0) || null;
  const operatorId =
    role === "doctor" ? null : Number(req.query.operator_id || 0) || null;
  const folderId = Number(req.query.folder_id || 0) || null;
  const includeEvents =
    view === "history" ||
    String(req.query.include_events || "") === "1" ||
    role === "operator" ||
    role === "admin";
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
    return res.json({
      requests: [],
      total: 0,
      doctor_counts: [],
      item_counts: [],
      completed_count: 0,
      cancelled_count: 0,
      request_count: 0,
    });
  }

  if (role !== "doctor" && role !== "operator" && role !== "admin") {
    return res.status(403).json({ error: "Not authorised to read restock requests." });
  }

  if (view === "queues") {
    if (role !== "operator" && role !== "admin") {
      return res.status(403).json({ error: "Only operators or admins can view work queues." });
    }
    return res.json(workQueues());
  }
  if (view === "metrics") {
    if (role !== "operator" && role !== "admin") {
      return res.status(403).json({ error: "Only operators or admins can view inventory metrics." });
    }
    return res.json(productivityMetrics());
  }

  const result = listRequests({
    status: statuses,
    doctorId: scopedDoctorId,
    requestId,
    from,
    to,
    itemSearch: itemSearch || null,
    operatorId,
    folderId,
    limit,
    offset,
    includeEvents,
  });

  const payload = {
    requests: result.requests,
    total: result.total,
    limit: usePaging ? limit : null,
    offset: usePaging ? offset : 0,
  };

  if (view === "history") {
    Object.assign(
      payload,
      historyStats({
        doctorId: scopedDoctorId,
        status: statuses.filter((value) => HISTORY_STATUSES.includes(value)),
        from,
        to,
        itemSearch: itemSearch || null,
        operatorId,
        folderId,
        requestId,
      }),
    );
    if (role === "operator" || role === "admin") {
      Object.assign(payload, historyLookups());
    }
  }

  return res.json(payload);
});

router.get("/queues", (req, res) => {
  const role = req.auth?.role;
  if (role !== "operator" && role !== "admin") {
    return res.status(403).json({ error: "Only operators or admins can view work queues." });
  }
  return res.json(workQueues());
});

router.get("/metrics", (req, res) => {
  const role = req.auth?.role;
  if (role !== "operator" && role !== "admin") {
    return res.status(403).json({ error: "Only operators or admins can view inventory metrics." });
  }
  return res.json(productivityMetrics());
});

router.get("/history-lookups", (req, res) => {
  const role = req.auth?.role;
  if (role !== "operator" && role !== "admin") {
    return res.status(403).json({ error: "Only operators or admins can view history lookups." });
  }
  return res.json(historyLookups());
});

router.get("/export", (req, res) => {
  const auth = req.auth;
  const role = auth?.role;
  if (role !== "doctor" && role !== "operator" && role !== "admin") {
    return res.status(403).json({ error: "Not authorised to export restock history." });
  }
  const statusFilter = parseStatusFilter(req.query.status);
  const statuses = (statusFilter || HISTORY_STATUSES).filter((value) => HISTORY_STATUSES.includes(value));
  const scopedDoctorId = role === "doctor" ? getDoctorIdForUser(auth.id) : Number(req.query.doctor_id || 0) || null;
  if (role === "doctor" && !scopedDoctorId) {
    return res.status(400).json({ error: "No doctor profile is linked to this account." });
  }
  const result = listRequests({
    status: statuses.length ? statuses : HISTORY_STATUSES,
    doctorId: scopedDoctorId,
    requestId: Number(req.query.request_id || req.query.id || 0) || null,
    from: parseIsoDateQuery(req.query.from),
    to: parseIsoDateQuery(req.query.to),
    itemSearch: String(req.query.item || req.query.q || "").trim() || null,
    operatorId: role === "doctor" ? null : Number(req.query.operator_id || 0) || null,
    folderId: Number(req.query.folder_id || 0) || null,
    includeEvents: false,
  });
  const stats = historyStats({
    doctorId: scopedDoctorId,
    status: statuses.length ? statuses : HISTORY_STATUSES,
    from: parseIsoDateQuery(req.query.from),
    to: parseIsoDateQuery(req.query.to),
    itemSearch: String(req.query.item || req.query.q || "").trim() || null,
    operatorId: role === "doctor" ? null : Number(req.query.operator_id || 0) || null,
    folderId: Number(req.query.folder_id || 0) || null,
    requestId: Number(req.query.request_id || req.query.id || 0) || null,
  });
  const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["request_id", "doctor", "status", "created_at", "completed_at", "cancelled_at", "items", "quantity"].join(","),
    ...result.requests.map((row) =>
      [
        row.id,
        escapeCsv(row.doctor_name),
        row.status,
        row.created_at || "",
        row.completed_at || "",
        row.cancelled_at || "",
        escapeCsv((row.items || []).map((item) => item.item_name).join("; ")),
        (row.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      ].join(","),
    ),
    "",
    "frequency_by_doctor",
    ["doctor", "request_count", "completed_count", "cancelled_count"].join(","),
    ...(stats.doctor_counts || []).map((row) =>
      [escapeCsv(row.doctor_name), row.request_count, row.completed_count, row.cancelled_count].join(","),
    ),
    "",
    "frequency_by_item",
    ["item", "request_count", "total_quantity", "total_fulfilled", "shortage_quantity"].join(","),
    ...(stats.item_counts || []).map((row) =>
      [
        escapeCsv(row.item_name),
        row.request_count,
        row.total_quantity,
        row.total_fulfilled,
        row.shortage_quantity,
      ].join(","),
    ),
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"supply-request-history.csv\"");
  return res.send(lines.join("\n"));
});

router.get("/:id/fulfilment", (req, res) => {
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
  return res.json({ request, fulfilment: fulfilmentDetail(requestId) });
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

  return res.json({ request, fulfilment: request.fulfilment || fulfilmentDetail(requestId) });
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
  if (decision === "rejected" && reason.length < 10) {
    return res.status(400).json({
      error: "A reason of at least 10 characters is required to decline a change request.",
    });
  }

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

      const updatedAmendment = db.prepare(`
        UPDATE restock_request_amendments
        SET
          status = ?,
          reviewed_by_user_id = ?,
          reviewed_at = CURRENT_TIMESTAMP,
          review_reason = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending'
      `).run(decision, req.auth.id, reason, amendmentId);
      if (!updatedAmendment.changes) {
        throw Object.assign(new Error("This change request has already been reviewed."), { status: 409 });
      }

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
        replaceReservationsForAmendment(requestId);
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

  if (role === "doctor") {
    const doctorId = getDoctorIdForUser(req.auth.id);
    if (Number(existing.doctor_id) !== Number(doctorId)) {
      return res.status(403).json({ error: "You can only change your own supply requests." });
    }
  } else if (role !== "operator" && role !== "admin") {
    return res.status(403).json({ error: "Only operators, admins, or the requesting doctor can update restock requests." });
  }

  let operationalOverride = { override: false, reason: "" };
  if (role === "admin" && ["accepted", "ready"].includes(nextStatus)) {
    try {
      operationalOverride = assertRoutineOperatorAction(
        req.auth,
        req.body,
        nextStatus === "accepted" ? "Accept supply requests" : "Mark supply ready",
      );
    } catch (error) {
      return res.status(error.status || 403).json({ error: error.message });
    }
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
      if (nextStatus === "ready") {
        assertCanMarkReady(requestId);
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

      if (nextStatus === "completed") {
        postCollectionTransfer({
          request: locked,
          actor,
        });
      }

      const result = db.prepare(sql).run(...params);
      if (!result.changes) {
        throw Object.assign(new Error("The supply request was updated by someone else. Refresh and try again."), {
          status: 409,
        });
      }

      if (nextStatus === "accepted") {
        const reserved = reserveAcceptedRequest(requestId);
        if (reserved.hasShortage) {
          recordEvent({
            requestId,
            eventType: EVENT_TYPES.shortageDetected,
            previousStatus: locked.status,
            newStatus: nextStatus,
            actor,
            reason: null,
            metadata: { lines: reserved.lines },
          });
        }
      } else if (nextStatus === "ready") {
        lockPackedFulfilment(requestId, req.auth.id);
      } else if (nextStatus === "cancelled") {
        releaseReservations(requestId);
        db.prepare(`
          UPDATE restock_request_fulfillments
          SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
          WHERE request_id = ? AND status IN ('open', 'picking', 'packed')
        `).run(requestId);
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
        reason: nextStatus === "cancelled" ? reason : operationalOverride.reason || null,
        metadata: {
          collection_date: locked.collection_date,
          items: snapshotItems(items),
          operational_override: Boolean(operationalOverride.override),
          override_reason: operationalOverride.reason || "",
          override_by_user_id: operationalOverride.override ? req.auth.id : null,
        },
      });

      if (nextStatus === "completed") {
        const posted = getRequestById(requestId);
        recordEvent({
          requestId,
          eventType: EVENT_TYPES.transferPosted,
          previousStatus: "ready",
          newStatus: "completed",
          actor,
          reason: null,
          metadata: {
            transfer_transaction_id: posted?.transfer_transaction_id || null,
            receipt_reference: posted?.transfer_transaction_id
              ? `/inventory/receipts/${posted.transfer_transaction_id}`
              : null,
          },
        });
      }
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

  if (operationalOverride.override) {
    notifyBestEffort(
      () =>
        sendPushToRole("operator", {
          title: "Emergency operational override",
          body: `An administrator ${nextStatus === "accepted" ? "accepted" : "marked ready"} request #${requestId}: ${operationalOverride.reason}`,
          url: "/inventory",
          icon: "/icon-192.png",
          tag: `restock-request-${requestId}-override`,
        }),
      "restock operational override notify failed",
    );
  }

  broadcastSupplyRequestChange(updated.doctor_id);
  return res.json({ request: updated });
});

router.patch("/:id/fulfilment", (req, res) => {
  const role = req.auth?.role;
  if (role !== "operator" && role !== "admin") {
    return res.status(403).json({ error: "Only operators or admins can update fulfilment." });
  }
  let fulfilmentOverride = { override: false, reason: "" };
  try {
    fulfilmentOverride = assertRoutineOperatorAction(req.auth, req.body, "Update fulfilment");
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.message });
  }
  const requestId = Number(req.params.id);
  if (!requestId) return res.status(400).json({ error: "Invalid restock request id." });
  const existing = db.prepare("SELECT * FROM restock_requests WHERE id = ?").get(requestId);
  if (!existing) return res.status(404).json({ error: "Supply request not found." });
  if (existing.status !== "accepted" && existing.status !== "ready") {
    return res.status(400).json({ error: "Fulfilment can only be updated while the request is accepted or ready." });
  }
  const actor = actorFromAuth(req.auth);

  try {
    const detail = db.transaction(() => {
      let next = null;
      if (req.body?.resolve_shortages) {
        const resolved = resolveShortages(requestId);
        next = resolved.detail;
        recordEvent({
          requestId,
          eventType: next?.has_shortage ? EVENT_TYPES.shortageDetected : EVENT_TYPES.shortageResolved,
          previousStatus: existing.status,
          newStatus: existing.status,
          actor,
          reason: null,
          metadata: { lines: resolved.lines || [] },
        });
      }
      next = applyPicking(requestId, {
        lines: Array.isArray(req.body?.lines) ? req.body.lines : [],
        partialApproved: Object.prototype.hasOwnProperty.call(req.body || {}, "partial_approved")
          ? Boolean(req.body.partial_approved)
          : Object.prototype.hasOwnProperty.call(req.body || {}, "partialApproved")
            ? Boolean(req.body.partialApproved)
            : undefined,
        partialReason: req.body?.partial_reason || req.body?.partialReason || "",
      });
      if (req.body?.lock) {
        lockPackedFulfilment(requestId, req.auth.id);
        next = fulfilmentDetail(requestId);
      }
      recordEvent({
        requestId,
        eventType: req.body?.partial_approved ? EVENT_TYPES.partialApproved : EVENT_TYPES.pickingUpdated,
        previousStatus: existing.status,
        newStatus: existing.status,
        actor,
        reason: req.body?.partial_reason || req.body?.allocation_reason || fulfilmentOverride.reason || null,
        metadata: {
          fulfilment: next,
          operational_override: Boolean(fulfilmentOverride.override),
          override_reason: fulfilmentOverride.reason || "",
        },
      });
      return next;
    })();
    const updated = getRequestById(requestId);
    if (fulfilmentOverride.override) {
      notifyBestEffort(
        () =>
          sendPushToRole("operator", {
            title: "Emergency operational override",
            body: `An administrator updated fulfilment for request #${requestId}: ${fulfilmentOverride.reason}`,
            url: "/inventory",
            icon: "/icon-192.png",
            tag: `restock-request-${requestId}-fulfil-override`,
          }),
        "fulfilment override notify failed",
      );
    }
    broadcastSupplyRequestChange(updated.doctor_id);
    return res.json({ request: updated, fulfilment: detail });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

router.post("/:id/assign", (req, res) => {
  const role = req.auth?.role;
  if (role !== "operator" && role !== "admin") {
    return res.status(403).json({ error: "Only operators or admins can assign requests." });
  }
  const requestId = Number(req.params.id);
  if (!requestId) return res.status(400).json({ error: "Invalid restock request id." });
  const existing = db.prepare("SELECT * FROM restock_requests WHERE id = ?").get(requestId);
  if (!existing) return res.status(404).json({ error: "Supply request not found." });
  const assigneeId = req.body?.user_id === null ? null : Number(req.body?.user_id || req.auth.id);
  assignRequest(requestId, assigneeId);
  recordEvent({
    requestId,
    eventType: EVENT_TYPES.assigned,
    previousStatus: existing.status,
    newStatus: existing.status,
    actor: actorFromAuth(req.auth),
    reason: null,
    metadata: { assigned_to_user_id: assigneeId },
  });
  const updated = getRequestById(requestId);
  broadcastSupplyRequestChange(updated.doctor_id);
  notifyBestEffort(
    () =>
      sendPushToRole("operator", {
        title: "Supply request assigned",
        body: `Request #${requestId} for Dr. ${updated.doctor_name} was assigned.`,
        url: "/inventory",
        icon: "/icon-192.png",
        tag: `restock-request-${requestId}-assigned`,
      }),
    "restock request assign notify failed",
  );
  return res.json({ request: updated });
});

router.post("/:id/reconcile", (req, res) => {
  const role = req.auth?.role;
  if (role !== "operator" && role !== "admin") {
    return res.status(403).json({ error: "Only operators or admins can reconcile fulfilment." });
  }
  let reconcileOverride = { override: false, reason: "" };
  try {
    reconcileOverride = assertRoutineOperatorAction(req.auth, req.body, "Reconcile fulfilment");
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.message });
  }
  const requestId = Number(req.params.id);
  if (!requestId) return res.status(400).json({ error: "Invalid restock request id." });
  let result;
  try {
    result = db.transaction(() => {
      const recon = reconcileLegacyFulfilment(requestId, {
        actor: actorFromAuth(req.auth),
        reason: String(req.body?.reason || "").trim() || "Legacy fulfilment linkage",
      });
      recordEvent({
        requestId,
        eventType: EVENT_TYPES.reconciled,
        previousStatus: recon.previous_status,
        newStatus: recon.status,
        actor: actorFromAuth(req.auth),
        reason: recon.explanation,
        metadata: {
          outcome: recon.outcome,
          requested_quantity: recon.requested_quantity,
          reserved_quantity: recon.reserved_quantity,
          operational_override: Boolean(reconcileOverride.override),
          override_reason: reconcileOverride.reason || req.body?.override_reason || "",
          legacy: true,
          demoted: recon.demoted,
          fulfilment: recon.fulfilment,
        },
      });
      return recon;
    })();
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  const updated = getRequestById(requestId);
  if (result.notify_doctor) {
    const doctorUserId = getDoctorUserId(updated.doctor_id);
    if (doctorUserId) {
      notifyBestEffort(
        () =>
          sendPushToUser(doctorUserId, {
            title: "Supply request needs attention",
            body: `Your previously ready request could not be fully reserved and was returned for shortage resolution.`,
            url: "/supply-requests",
            icon: "/icon-192.png",
            tag: `restock-request-${requestId}-reconcile-shortage`,
          }),
        "legacy reconcile doctor notify failed",
      );
    }
  }
  if (reconcileOverride.override) {
    notifyBestEffort(
      () =>
        sendPushToRole("operator", {
          title: "Emergency operational override",
          body: `An administrator reconciled request #${requestId}: ${reconcileOverride.reason}`,
          url: "/inventory",
          icon: "/icon-192.png",
          tag: `restock-request-${requestId}-reconcile-override`,
        }),
      "reconcile override notify failed",
    );
  }
  broadcastSupplyRequestChange(updated.doctor_id);
  return res.json({
    request: updated,
    fulfilment: result.fulfilment || fulfilmentDetail(requestId),
    previous_status: result.previous_status,
    status: result.status,
    demoted: result.demoted,
    outcome: result.outcome,
    explanation: result.explanation,
  });
});

router.delete("/:id", (_req, res) => {
  return res.status(405).json({
    error: "Supply requests cannot be permanently deleted. Cancel and archive them instead.",
  });
});

module.exports = router;
module.exports.listRequests = listRequests;
module.exports.getRequestById = getRequestById;
