import dayjs from "dayjs";
import { api } from "./api.js";

export function supplyRequestStatusTone(status) {
  if (status === "prepared") {
    return "bg-emerald-50 text-emerald-700";
  }
  if (status === "cancelled") {
    return "bg-gray-100 text-gray-500";
  }
  return "bg-ocs-yellow/10 text-ocs-yellow-dark";
}

export function supplyRequestStatusLabel(status) {
  if (status === "prepared") return "Prepared";
  if (status === "cancelled") return "Cancelled";
  return "Pending";
}

export function formatSupplyRequestCollectionDay(collectionDate) {
  if (!collectionDate) return "—";
  return dayjs(collectionDate).format("ddd, DD MMM YYYY");
}

/** Doctors never see cancelled rows; admins retain them in the database for audit. */
export function isDisplayableSupplyRequest(request) {
  return String(request?.status || "").trim().toLowerCase() !== "cancelled";
}

export function filterDisplayableSupplyRequests(requests = []) {
  return (Array.isArray(requests) ? requests : []).filter(isDisplayableSupplyRequest);
}

export async function fetchDoctorSupplyRequests() {
  const payload = await api.get("/restock-requests?status=pending,prepared");
  return filterDisplayableSupplyRequests(
    Array.isArray(payload?.requests) ? payload.requests : [],
  );
}
