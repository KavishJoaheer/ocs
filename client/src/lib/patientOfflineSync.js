import { api } from "./api.js";
import { isBrowserOffline, isNetworkFailure } from "./networkErrors.js";
import {
  clearPatientOfflineCache,
  getPatientDirectoryCache,
  savePatientDirectoryCache,
} from "./patientOfflineCache.js";

export const PATIENT_OFFLINE_CACHE_UPDATED = "patient-offline-cache-updated";

function dispatchCacheUpdated(detail = {}) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(PATIENT_OFFLINE_CACHE_UPDATED, { detail }));
}

export function mapOfflineRecordToPatient(record) {
  const [agePart, genderPart] = String(record.age_gender || "")
    .split(",")
    .map((part) => part.trim());

  return {
    id: record.id,
    full_name: record.full_name,
    patient_identifier: record.patient_id || record.patient_identifier || "",
    patient_id_number: record.patient_id_number || "",
    status: record.status || "active",
    gender:
      record.gender ||
      (genderPart === "Male" ? "M" : genderPart === "Female" ? "F" : genderPart || ""),
    date_of_birth: record.date_of_birth || "",
    location: record.location || record.address_location || "",
    assigned_doctor_id: record.assigned_doctor_id ?? null,
    assigned_doctor_name: record.assigned_doctor_name || "",
    offline_directory: {
      patient_id: record.patient_id,
      age_gender: record.age_gender,
      contact_number: record.contact_number,
      emergency_contact: record.emergency_contact,
      address_location: record.address_location,
      medical_alerts: record.medical_alerts,
      last_consultation_summary: record.last_consultation_summary,
    },
    _offlineCached: true,
  };
}

export function filterOfflineDirectoryItems(items, { search = "", statusFilter = "all" } = {}) {
  const needle = String(search || "")
    .trim()
    .toLowerCase();

  return items.filter((record) => {
    if (statusFilter !== "all" && String(record.status || "") !== statusFilter) {
      return false;
    }

    if (!needle) {
      return true;
    }

    const haystack = [
      record.full_name,
      record.patient_id,
      record.contact_number,
      record.emergency_contact,
      record.address_location,
      record.medical_alerts,
    ]
      .map((value) => String(value || "").toLowerCase())
      .join(" ");

    return haystack.includes(needle);
  });
}

export function buildOfflinePatientsPage(items, page = 1, limit = 15) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const offset = (safePage - 1) * limit;

  return {
    items: items.slice(offset, offset + limit).map(mapOfflineRecordToPatient),
    pagination: {
      page: safePage,
      limit,
      total,
      totalPages,
    },
    offline: true,
    synced_at: null,
  };
}

export async function prefetchPatientOfflineDirectory(userId, { force = false } = {}) {
  if (!userId || isBrowserOffline()) {
    return null;
  }

  try {
    const payload = await api.get("/patients/offline-directory");
    await savePatientDirectoryCache(userId, payload);
    dispatchCacheUpdated({ synced_at: payload.synced_at, total: payload.total });
    return payload;
  } catch (error) {
    if (!force) {
      console.warn("Patient offline prefetch failed:", error?.message || error);
    }
    return null;
  }
}

export async function loadPatientDirectory({
  userId,
  search = "",
  statusFilter = "all",
  page = 1,
  limit = 15,
}) {
  const readCache = async () => {
    const cached = await getPatientDirectoryCache(userId);
    if (!cached?.items?.length) {
      return {
        items: [],
        pagination: { page: 1, limit, total: 0, totalPages: 1 },
        offline: true,
        synced_at: cached?.synced_at || null,
      };
    }

    const filtered = filterOfflineDirectoryItems(cached.items, { search, statusFilter });
    const pagePayload = buildOfflinePatientsPage(filtered, page, limit);
    return {
      ...pagePayload,
      synced_at: cached.synced_at || null,
    };
  };

  if (isBrowserOffline()) {
    return readCache();
  }

  try {
    const freshData = await api.get("/patients/offline-directory");
    await savePatientDirectoryCache(userId, freshData);
    dispatchCacheUpdated({ synced_at: freshData.synced_at, total: freshData.total });

    const filtered = filterOfflineDirectoryItems(freshData.items || [], { search, statusFilter });
    return {
      ...buildOfflinePatientsPage(filtered, page, limit),
      offline: false,
      synced_at: freshData.synced_at,
    };
  } catch (error) {
    console.warn("Online patient directory prefetch failed, falling back to local storage cache.");
    if (isNetworkFailure(error)) {
      return readCache();
    }
    throw error;
  }
}

export async function getCachedPatientDirectory(userId) {
  return getPatientDirectoryCache(userId);
}

export { clearPatientOfflineCache };
