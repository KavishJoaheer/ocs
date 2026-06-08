import dayjs from "dayjs";
import { calculateAgeFromDateOfBirth } from "./format.js";

/**
 * Parse a 14-character Mauritian National ID (e.g. B290493310239F) into DOB and age.
 * @param {string} idString
 * @returns {{ formattedDob: string, isoDob: string, age: number } | null}
 */
export function parseMauritianID(idString) {
  if (!idString) {
    return null;
  }

  const cleanID = String(idString).trim().toUpperCase();
  if (cleanID.length !== 14) {
    return null;
  }

  const dayStr = cleanID.substring(1, 3);
  const monthStr = cleanID.substring(3, 5);
  const shortYearStr = cleanID.substring(5, 7);

  const day = Number.parseInt(dayStr, 10);
  const month = Number.parseInt(monthStr, 10);
  const shortYear = Number.parseInt(shortYearStr, 10);

  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return null;
  }

  const currentYearShort = new Date().getFullYear() % 100;
  const centuryPrefix = shortYear <= currentYearShort ? "20" : "19";
  const fullYear = Number.parseInt(`${centuryPrefix}${shortYearStr}`, 10);

  const isoDob = `${fullYear}-${monthStr}-${dayStr}`;
  const parsed = dayjs(isoDob);

  if (!parsed.isValid() || parsed.format("YYYY-MM-DD") !== isoDob) {
    return null;
  }

  if (parsed.date() !== day || parsed.month() + 1 !== month) {
    return null;
  }

  const age = calculateAgeFromDateOfBirth(isoDob);
  if (age === null) {
    return null;
  }

  return {
    formattedDob: `${dayStr}/${monthStr}/${fullYear}`,
    isoDob,
    age,
  };
}
