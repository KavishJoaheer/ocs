import dayjs from "dayjs";
import { api } from "./api.js";

export function supplyRequestStatusTone(status) {
  if (status === "prepared") {
    return "bg-emerald-50 text-emerald-700";
  }
  if (status === "cancelled") {
    return "bg-gray-100 text-gray-500";
  }
  return "bg-[#fcf3ee] text-[#ba5a32]";
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

export async function fetchDoctorSupplyRequests() {
  const payload = await api.get("/restock-requests?status=pending,prepared,cancelled");
  return Array.isArray(payload?.requests) ? payload.requests : [];
}
