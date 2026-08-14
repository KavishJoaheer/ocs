import { api } from "./api.js";

export const PATIENT_CANCELLABLE_STATUSES = [
  "pending",
  "acknowledged",
  "assigned",
  "en_route",
];

export function canPatientCancelVisit(status) {
  return PATIENT_CANCELLABLE_STATUSES.includes(String(status || "").trim());
}

export async function cancelPatientVisit(visitId) {
  return api.patch(`/patient-portal/visit-requests/${visitId}/cancel`);
}

const ACTIVE_VISIT_RANK = {
  in_consultation: 6,
  arrived: 5,
  en_route: 4,
  assigned: 3,
  acknowledged: 2,
  pending: 1,
};

function visitProgressRank(visit) {
  return ACTIVE_VISIT_RANK[String(visit?.status || "").trim()] || 0;
}

export function pickVisibleActiveVisit(payload) {
  const own = payload?.visit_request || null;
  const family = Array.isArray(payload?.family_visit_requests)
    ? payload.family_visit_requests
    : [];
  const candidates = [own, ...family].filter(Boolean);
  if (candidates.length === 0) {
    return null;
  }

  // A guardian's own pending request must not hide a child's visit that is
  // already further along (assigned / en route / arrived).
  return candidates.reduce((best, visit) => {
    const visitRank = visitProgressRank(visit);
    const bestRank = visitProgressRank(best);
    if (visitRank > bestRank) {
      return visit;
    }
    if (visitRank < bestRank) {
      return best;
    }
    const visitTime = Date.parse(visit.updated_at || visit.created_at || "") || 0;
    const bestTime = Date.parse(best.updated_at || best.created_at || "") || 0;
    return visitTime > bestTime ? visit : best;
  });
}
