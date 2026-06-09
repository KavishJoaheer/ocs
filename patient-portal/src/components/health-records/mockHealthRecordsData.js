/** Mock data for Health Records — swap with API payloads in production. */

export const MOCK_CONSULTATIONS = [
  {
    id: 1,
    date: "2026-06-09",
    time: "10:30 AM",
    doctor_name: "Shravan Joaheer",
    doctor_specialty: "General Practitioner",
    visit_type: "Home Visit",
    diagnosis: "URTI",
    plain_summary:
      "Mild upper respiratory symptoms assessed at home. Rest, fluids, and symptomatic treatment advised.",
  },
  {
    id: 2,
    date: "2026-03-28",
    time: "2:15 PM",
    doctor_name: "Marie Dubois",
    doctor_specialty: "General Practitioner",
    visit_type: "Home Visit",
    diagnosis: "Seasonal Allergic Rhinitis",
    plain_summary: "Seasonal allergy flare managed with antihistamine guidance and follow-up if needed.",
  },
  {
    id: 3,
    date: "2026-01-14",
    time: "9:00 AM",
    doctor_name: "Keith Smith",
    doctor_specialty: "General Practitioner",
    visit_type: "Home Visit",
    diagnosis: "Acute Pharyngitis",
    plain_summary: "Sore throat and mild fever reviewed. Throat swab not required; recovery expected within 5–7 days.",
  },
];

export const MOCK_REPORTS = [
  {
    id: 101,
    name: "Complete Blood Count",
    report_date: "2026-05-10",
    requested_by_source: "OCS Doctor",
    url: "#",
  },
  {
    id: 102,
    name: "Chest X-Ray",
    report_date: "2026-02-18",
    requested_by_source: "External Doctor",
    url: "#",
  },
  {
    id: 103,
    name: "Lipid Panel",
    report_date: "2025-11-04",
    requested_by_source: "OCS Doctor",
    url: "#",
  },
];

export const MOCK_CLINICAL = {
  medical_history: [
    { id: 1, name: "Hypertension", detail: "Diagnosed 2021" },
  ],
  surgical_history: [
    { id: 1, name: "Appendectomy", detail: "2015" },
  ],
  drug_history: [
    { id: 1, name: "Amlodipine 5mg", detail: "Daily" },
    { id: 2, name: "Paracetamol 500mg", detail: "As needed" },
  ],
  allergy_history: [
    { id: 1, name: "Penicillin", detail: "Rash — documented 2019" },
  ],
};
