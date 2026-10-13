/** Add the separator after a three-digit systolic value. An explicit slash
 * also supports shorter values such as 90/60. */
export function formatBloodPressureInput(value, previousValue = "") {
  const raw = String(value || "").replace(/[^\d/]/g, "");
  if (previousValue.endsWith("/") && raw === previousValue.slice(0, -1)) {
    return raw.slice(0, -1);
  }
  if (raw.includes("/")) {
    const [systolic, ...remaining] = raw.split("/");
    return `${systolic.slice(0, 3)}/${remaining.join("").slice(0, 3)}`;
  }
  return raw.length >= 3 ? `${raw.slice(0, 3)}/${raw.slice(3, 6)}` : raw;
}

/** Keep units outside the editable value so typing and deletion stay natural. */
export function formatVitalInput(key, value, previousValue = "") {
  if (key === "vital_bp") return formatBloodPressureInput(value, previousValue);
  if (key === "vital_temperature") return String(value).replace(/\s*°?\s*c\s*$/i, "").trim().replace(",", ".");
  if (key === "vital_spo2") return String(value).replace(/\s*%\s*$/, "").trim();
  return value;
}
