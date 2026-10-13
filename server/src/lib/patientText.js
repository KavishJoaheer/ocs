function capitalizeFirstLetter(value) {
  return String(value ?? "").replace(/\p{L}/u, letter => letter.toUpperCase());
}

module.exports = { capitalizeFirstLetter };
