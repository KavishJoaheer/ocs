export function formatDisplayName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return trimmed;

  return trimmed
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
