import { normalizeNationalIdInput, parseMauritianID } from "./nicParser.js";

export { normalizeNationalIdInput, parseMauritianID };

export function validateRegisterForm(form) {
  const errors = {};
  const nationalId = normalizeNationalIdInput(form.national_id);
  const parsedNic = parseMauritianID(nationalId);

  if (!String(form.full_name || "").trim()) {
    errors.full_name = "Full name is required.";
  }
  if (!String(form.email || "").trim()) {
    errors.email = "Email is required.";
  }
  if (!String(form.phone || "").trim()) {
    errors.phone = "Phone number is required.";
  }

  if (!nationalId) {
    errors.national_id = "National ID is required to match your medical records.";
  } else if (nationalId.length !== 14) {
    errors.national_id = "Enter your 14-character Mauritian National ID.";
  } else if (!parsedNic) {
    errors.national_id = "This National ID does not look valid. Check the number and try again.";
  }

  if (!["M", "F"].includes(form.gender)) {
    errors.gender = "Please select your gender.";
  }

  if (!form.password) {
    errors.password = "Password is required.";
  } else if (form.password.length < 8) {
    errors.password = "Password must be at least 8 characters.";
  }

  if (form.password !== form.confirmPassword) {
    errors.confirmPassword = "Passwords do not match.";
  }

  return { errors, nationalId, parsedNic };
}
