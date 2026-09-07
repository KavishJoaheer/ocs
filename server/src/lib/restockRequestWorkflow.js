const ACTIVE_STATUSES = ["pending", "accepted", "ready"];
const HISTORY_STATUSES = ["completed", "cancelled"];
const ALL_STATUSES = [...ACTIVE_STATUSES, ...HISTORY_STATUSES];

const EVENT_TYPES = {
  created: "request_created",
  edited: "pending_request_edited",
  accepted: "request_accepted",
  amendmentSubmitted: "amendment_submitted",
  amendmentAccepted: "amendment_accepted",
  amendmentRejected: "amendment_rejected",
  assigned: "request_assigned",
  pickingUpdated: "picking_updated",
  shortageDetected: "shortage_detected",
  shortageResolved: "shortage_resolved",
  partialApproved: "partial_fulfilment_approved",
  ready: "supply_marked_ready",
  cancelled: "request_cancelled",
  completed: "supply_collected",
  transferPosted: "inventory_transfer_posted",
  reconciled: "fulfilment_reconciled",
};

const OPERATOR_TRANSITIONS = {
  pending: ["accepted", "cancelled"],
  accepted: ["ready", "cancelled"],
};

const ADMIN_TRANSITIONS = {
  pending: ["accepted", "cancelled"],
  accepted: ["ready", "cancelled"],
  ready: ["cancelled"],
};

const DOCTOR_TRANSITIONS = {
  pending: ["cancelled"],
  ready: ["completed"],
};

function normaliseStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "prepared") return "ready";
  return status;
}

function isActiveStatus(status) {
  return ACTIVE_STATUSES.includes(normaliseStatus(status));
}

function isHistoryStatus(status) {
  return HISTORY_STATUSES.includes(normaliseStatus(status));
}

function allowedTransitionsForRole(role) {
  if (role === "doctor") return DOCTOR_TRANSITIONS;
  if (role === "admin") return ADMIN_TRANSITIONS;
  if (role === "operator") return OPERATOR_TRANSITIONS;
  return {};
}

function canTransition(role, fromStatus, toStatus) {
  const from = normaliseStatus(fromStatus);
  const to = normaliseStatus(toStatus);
  const allowed = allowedTransitionsForRole(role)[from] || [];
  return allowed.includes(to);
}

function supplyRequestStatusLabel(status, role) {
  const value = normaliseStatus(status);
  if (value === "pending") {
    return role === "doctor" ? "Requested" : "Pending";
  }
  if (value === "accepted") return "Request Accepted";
  if (value === "ready") return "Supply Ready";
  if (value === "completed") {
    if (role === "doctor") return "Supply Collected";
    if (role === "operator") return "Supply Dispatched";
    return "Completed";
  }
  if (value === "cancelled") return "Cancelled";
  return value || "Unknown";
}

function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function snapshotItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    inventory_id: item.inventory_id ? Number(item.inventory_id) : null,
    item_name: item.item_name,
    quantity: Number(item.quantity || 0),
  }));
}

const EVENT_LABELS = {
  request_created: "Request submitted",
  pending_request_edited: "Request edited",
  request_accepted: "Request accepted",
  amendment_submitted: "Change request submitted",
  amendment_accepted: "Change request accepted",
  amendment_rejected: "Change request declined",
  request_assigned: "Assigned to operator",
  picking_updated: "Picking updated",
  shortage_detected: "Shortage recorded",
  shortage_resolved: "Shortage resolved",
  partial_fulfilment_approved: "Partial fulfilment approved",
  supply_marked_ready: "Supply marked ready",
  request_cancelled: "Request cancelled",
  supply_collected: "Collection confirmed",
  inventory_transfer_posted: "Warehouse transfer posted",
  fulfilment_reconciled: "Fulfilment reconciled",
};

function supplyRequestEventLabel(eventType) {
  const key = String(eventType || "").trim();
  return EVENT_LABELS[key] || key.replace(/_/g, " ") || "Update";
}

function actorFromAuth(auth) {
  return {
    userId: auth?.id ? Number(auth.id) : null,
    role: auth?.role || null,
    displayName: auth?.full_name || auth?.username || null,
  };
}

module.exports = {
  ACTIVE_STATUSES,
  ALL_STATUSES,
  DOCTOR_TRANSITIONS,
  EVENT_TYPES,
  EVENT_LABELS,
  HISTORY_STATUSES,
  ADMIN_TRANSITIONS,
  OPERATOR_TRANSITIONS,
  actorFromAuth,
  canTransition,
  isActiveStatus,
  isHistoryStatus,
  normaliseStatus,
  parseMetadata,
  snapshotItems,
  supplyRequestEventLabel,
  supplyRequestStatusLabel,
};
