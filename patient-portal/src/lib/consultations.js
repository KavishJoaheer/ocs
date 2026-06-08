/**
 * Single source of truth for the patient's consultation history.
 *
 * Both the Health Records page (Consultation History tab) and the dashboard's
 * "Last Consultation" card read from here so the two stay in sync.
 */
export const CONSULTATIONS = [
  {
    id: 1,
    date: "2026-06-07",
    doctor_name: "Dr. Avinash Sharma",
    diagnosis: "URTI",
    reports: [
      {
        id: 1,
        name: "Throat Swab Results — 7 June 2026",
        url: "/sample-reports/throat-swab-results.pdf",
      },
    ],
  },
  {
    id: 2,
    date: "2026-04-15",
    doctor_name: "Dr. Priya Nair",
    diagnosis: "Viral Fever",
    reports: [
      {
        id: 2,
        name: "Blood Panel — 15 April 2026",
        url: "/sample-reports/blood-panel-april.pdf",
      },
    ],
  },
  {
    id: 3,
    date: "2026-01-02",
    doctor_name: "Dr. Avinash Sharma",
    diagnosis: "Hypertension Review",
    reports: [],
  },
];

/** Returns the most recent consultation by date, or null if there are none. */
export function getLastConsultation() {
  if (CONSULTATIONS.length === 0) return null;
  return [...CONSULTATIONS].sort(
    (a, b) => new Date(b.date) - new Date(a.date),
  )[0];
}
