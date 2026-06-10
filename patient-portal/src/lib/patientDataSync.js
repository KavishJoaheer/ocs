import { PATIENT_DATA_EVENT } from "./realtime.js";

/** Notify all patient-portal views to refetch live data (profile save, local mutations). */
export function dispatchPatientDataChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PATIENT_DATA_EVENT));
}
