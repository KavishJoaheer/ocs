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
