/** True only when env var is exactly "true" (case-insensitive). Empty, "false", "0" → false. */
function isEnvTrue(name) {
  return String(process.env[name] || "").trim().toLowerCase() === "true";
}

module.exports = { isEnvTrue };
