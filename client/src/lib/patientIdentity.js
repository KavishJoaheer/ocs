import { parseMauritianID } from "./nicParser.js";

export const PATIENT_ID_TYPES = [
  { value: "national_id", label: "National ID Number" },
  { value: "driving_licence", label: "Driving Licence" },
  { value: "passport", label: "Passport Number" },
  { value: "birth_certificate", label: "Birth Certificate Number" },
  { value: "old_age", label: "Old Age" },
  { value: "no_id", label: "No ID available" },
];

export function requiresPatientIdNumber(type) {
  return !["old_age", "no_id"].includes(type);
}

export function validatePatientIdentity(form) {
  const type = form.patient_id_type || "national_id";
  const number = String(form.patient_id_number || "").trim();
  if (requiresPatientIdNumber(type) && !number) {
    return `${PATIENT_ID_TYPES.find((item) => item.value === type)?.label || "ID number"} is required.`;
  }
  if (type === "national_id" && !parseMauritianID(number)) {
    return "Enter a valid 14-character National ID Number to fill date of birth and age.";
  }
  if (form.manual_age !== "" && form.manual_age != null &&
      (!Number.isInteger(Number(form.manual_age)) || Number(form.manual_age) < 0)) {
    return "Age must be a whole number of years, zero or greater.";
  }
  return null;
}
