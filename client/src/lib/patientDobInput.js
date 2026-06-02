import dayjs from "dayjs";
import { calculateAgeFromDateOfBirth } from "./format.js";

/** Format up to 8 digits as DD/MM/YYYY while typing. */
export function maskDigitsToDobDisplay(digits) {
  const value = String(digits || "")
    .replace(/\D/g, "")
    .slice(0, 8);

  if (value.length <= 2) {
    return value;
  }

  if (value.length <= 4) {
    return `${value.slice(0, 2)}/${value.slice(2)}`;
  }

  return `${value.slice(0, 2)}/${value.slice(2, 4)}/${value.slice(4)}`;
}

export function isoToDobDisplayMask(isoDate) {
  const parsed = dayjs(String(isoDate || "").trim().slice(0, 10));
  return parsed.isValid() ? parsed.format("DD/MM/YYYY") : "";
}

/**
 * Parse DD/MM/YYYY mask to YYYY-MM-DD when valid; otherwise null.
 */
export function parseDobMaskToIso(dobString) {
  if (String(dobString || "").length !== 10) {
    return null;
  }

  const [dayPart, monthPart, yearPart] = dobString.split("/");
  const day = Number.parseInt(dayPart, 10);
  const month = Number.parseInt(monthPart, 10);
  const year = Number.parseInt(yearPart, 10);

  if (!day || !month || !year || month > 12 || day > 31) {
    return null;
  }

  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = dayjs(iso);

  if (!parsed.isValid() || parsed.format("YYYY-MM-DD") !== iso) {
    return null;
  }

  if (parsed.date() !== day || parsed.month() + 1 !== month) {
    return null;
  }

  return iso;
}

export function calculateAgeFromDobMask(dobString) {
  const iso = parseDobMaskToIso(dobString);
  if (!iso) {
    return null;
  }

  return calculateAgeFromDateOfBirth(iso);
}
