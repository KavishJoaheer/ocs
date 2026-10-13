// Capitalize the first letter, including after a street number or punctuation,
// without changing the patient's chosen spelling or the remaining casing.
export function capitalizeFirstLetter(value) {
  return String(value ?? "").replace(/\p{L}/u, letter => letter.toUpperCase());
}
