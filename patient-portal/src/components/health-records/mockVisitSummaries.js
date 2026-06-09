/** Full visit summary payloads — keyed by consultation id. */

import { MOCK_CONSULTATIONS } from "./mockHealthRecordsData.js";

const PRESCRIPTION_SETS = {
  1: [
    { id: "rx-1", name: "Paracetamol", dosage: "500mg — Twice daily", duration: "5 Days", type: "pill" },
    { id: "rx-2", name: "Cough Syrup", dosage: "10ml — After meals", duration: "7 Days", type: "syrup" },
  ],
  2: [
    { id: "rx-3", name: "Cetirizine", dosage: "10mg — Once daily", duration: "10 Days", type: "pill" },
  ],
  3: [
    { id: "rx-4", name: "Amoxicillin", dosage: "500mg — Three times daily", duration: "7 Days", type: "pill" },
    { id: "rx-5", name: "Throat Lozenges", dosage: "As needed", duration: "5 Days", type: "pill" },
  ],
};

const DOCUMENT_SETS = {
  1: [
    { id: "doc-1", name: "Medical Certificate", url: "#" },
    { id: "doc-2", name: "Lab Request", url: "#" },
  ],
  2: [{ id: "doc-3", name: "Medical Certificate", url: "#" }],
  3: [
    { id: "doc-4", name: "Medical Certificate", url: "#" },
    { id: "doc-5", name: "Lab Request", url: "#" },
  ],
};

/** Build a visit summary from base consultation + enriched fields. */
export function buildVisitSummary(consultation) {
  if (!consultation) return null;

  const id = consultation.id;
  return {
    ...consultation,
    prescriptions: consultation.prescriptions || PRESCRIPTION_SETS[id] || [],
    documents: consultation.documents || DOCUMENT_SETS[id] || [],
  };
}

export function getMockVisitSummary(consultationId) {
  const base = MOCK_CONSULTATIONS.find((c) => String(c.id) === String(consultationId));
  return buildVisitSummary(base);
}

export function enrichConsultationForSummary(consultation) {
  return buildVisitSummary(consultation);
}
