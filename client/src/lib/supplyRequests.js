import dayjs from "dayjs";
import { api } from "./api.js";

export const ACTIVE_SUPPLY_STATUSES = ["pending", "accepted", "ready"];
export const HISTORY_SUPPLY_STATUSES = ["completed", "cancelled"];

export function normaliseSupplyRequestStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "prepared") return "ready";
  return value;
}

export function isActiveSupplyRequestStatus(status) {
  return ACTIVE_SUPPLY_STATUSES.includes(normaliseSupplyRequestStatus(status));
}

export function isHistorySupplyRequestStatus(status) {
  return HISTORY_SUPPLY_STATUSES.includes(normaliseSupplyRequestStatus(status));
}

export function supplyRequestStatusTone(status) {
  const value = normaliseSupplyRequestStatus(status);
  if (value === "accepted") return "bg-sky-50 text-sky-700";
  if (value === "ready") return "bg-emerald-50 text-emerald-700";
  if (value === "completed") return "bg-teal-50 text-teal-800";
  if (value === "cancelled") return "bg-gray-100 text-gray-500";
  return "bg-ocs-yellow/10 text-ocs-yellow-dark";
}

export function supplyRequestStatusLabel(status, role = "doctor") {
  const value = normaliseSupplyRequestStatus(status);
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

export function supplyRequestStatusLabelForUser(request, role = "doctor") {
  const labels = request?.status_labels;
  if (labels && labels[role]) return labels[role];
  return supplyRequestStatusLabel(request?.status, role);
}

export function formatSupplyRequestCollectionDay(collectionDate) {
  if (!collectionDate) return "—";
  return dayjs(collectionDate).format("ddd, DD MMM YYYY");
}

export function formatSupplyRequestTimestamp(value) {
  if (!value) return "—";
  const parsed = dayjs(value);
  if (!parsed.isValid()) return "—";
  return parsed.format("DD MMM YYYY, HH:mm");
}

export function describeSupplyRequestItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => `${item.item_name} × ${item.quantity}`)
    .join(", ");
}

function amendmentItemKey(item) {
  const inventoryId = Number(item?.inventory_id || 0);
  const name = String(item?.item_name || "").trim().toLowerCase();
  return inventoryId ? `id:${inventoryId}` : `name:${name}`;
}

export function compareSupplyRequestAmendment(currentItems = [], proposedItems = []) {
  const currentMap = new Map(
    (Array.isArray(currentItems) ? currentItems : []).map((item) => [amendmentItemKey(item), item]),
  );
  const proposedMap = new Map(
    (Array.isArray(proposedItems) ? proposedItems : []).map((item) => [amendmentItemKey(item), item]),
  );
  const keys = [...new Set([...currentMap.keys(), ...proposedMap.keys()])];
  return keys.map((key) => {
    const current = currentMap.get(key) || null;
    const proposed = proposedMap.get(key) || null;
    const currentQty = current == null ? null : Number(current.quantity);
    const proposedQty = proposed == null ? null : Number(proposed.quantity);
    let change = "unchanged";
    if (!current && proposed) change = "added";
    else if (current && !proposed) change = "removed";
    else if (currentQty !== proposedQty) change = "quantity";
    return {
      key,
      item_name: proposed?.item_name || current?.item_name || "Item",
      current_quantity: currentQty,
      proposed_quantity: proposedQty,
      change,
    };
  });
}

/** Active lists exclude completed/cancelled rows; history screens show those instead. */
export function isDisplayableSupplyRequest(request) {
  return isActiveSupplyRequestStatus(request?.status);
}

export function filterDisplayableSupplyRequests(requests = []) {
  return (Array.isArray(requests) ? requests : []).filter(isDisplayableSupplyRequest);
}

export function filterHistorySupplyRequests(requests = []) {
  return (Array.isArray(requests) ? requests : []).filter((request) =>
    isHistorySupplyRequestStatus(request?.status),
  );
}

function buildSupplyRequestQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

export async function fetchDoctorSupplyRequests() {
  const payload = await api.get("/restock-requests");
  return filterDisplayableSupplyRequests(
    Array.isArray(payload?.requests) ? payload.requests : [],
  );
}

export async function fetchSupplyRequestHistory(params = {}) {
  const payload = await api.get(
    `/restock-requests${buildSupplyRequestQuery({
      view: "history",
      include_events: "1",
      ...params,
    })}`,
  );
  return {
    requests: Array.isArray(payload?.requests) ? payload.requests : [],
    total: Number(payload?.total || 0),
    doctor_counts: Array.isArray(payload?.doctor_counts) ? payload.doctor_counts : [],
    item_counts: Array.isArray(payload?.item_counts) ? payload.item_counts : [],
  };
}

export function canDoctorEditRequest(request) {
  return normaliseSupplyRequestStatus(request?.status) === "pending";
}

export function canDoctorCancelRequest(request) {
  return normaliseSupplyRequestStatus(request?.status) === "pending";
}

export function canDoctorRequestChanges(request) {
  return (
    normaliseSupplyRequestStatus(request?.status) === "accepted" && !request?.pending_amendment
  );
}

export function canDoctorConfirmCollection(request) {
  return normaliseSupplyRequestStatus(request?.status) === "ready";
}

export function summarizeActiveSupplyRequests(requests = [], role = "operator") {
  const rows = Array.isArray(requests) ? requests : [];
  const pending = rows.filter((row) => normaliseSupplyRequestStatus(row.status) === "pending").length;
  const accepted = rows.filter((row) => normaliseSupplyRequestStatus(row.status) === "accepted").length;
  const ready = rows.filter((row) => normaliseSupplyRequestStatus(row.status) === "ready").length;
  const changes = rows.filter((row) => row.pending_amendment).length;
  if (!rows.length) return "No active supply requests";
  const parts = [];
  if (pending) {
    parts.push(`${pending} awaiting acceptance`);
  }
  if (accepted) {
    parts.push(`${accepted} being prepared`);
  }
  if (ready) {
    parts.push(`${ready} awaiting collection`);
  }
  if (changes) {
    parts.push(`${changes} change request${changes === 1 ? "" : "s"}`);
  }
  const prefix =
    rows.length > 1 && (accepted || ready || pending > 1)
      ? `${rows.length} active requests · `
      : "";
  if (!parts.length) {
    return role === "doctor" ? "Active supply requests" : `${rows.length} active request${rows.length === 1 ? "" : "s"}`;
  }
  return `${prefix}${parts.join(" · ")}`;
}

export async function fetchSupplyRequestDetail(id) {
  const payload = await api.get(`/restock-requests/${id}`);
  return payload?.request || null;
}
