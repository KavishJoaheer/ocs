function calculateAgeFromIsoDate(isoDob) {
  const normalized = String(isoDob || "").trim();
  if (!normalized) {
    return null;
  }

  const birthDate = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDifference = today.getMonth() - birthDate.getMonth();
  if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }

  return Math.max(age, 0);
}

/**
 * Parse a 14-character Mauritian National ID (e.g. B290493310239F) into DOB and age.
 */
function parseMauritianID(idString) {
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
  const parsed = new Date(`${isoDob}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (parsed.getDate() !== day || parsed.getMonth() + 1 !== month || parsed.getFullYear() !== fullYear) {
    return null;
  }

  const age = calculateAgeFromIsoDate(isoDob);
  if (age === null) {
    return null;
  }

  return {
    formattedDob: `${dayStr}/${monthStr}/${fullYear}`,
    isoDob,
    age,
  };
}

module.exports = {
  calculateAgeFromIsoDate,
  parseMauritianID,
};
