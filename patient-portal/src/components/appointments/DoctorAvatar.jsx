function doctorInitials(name) {
  const trimmed = String(name || "Dr").replace(/^dr\.?\s+/i, "").trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "DR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function DoctorAvatar({ name, size = "sm" }) {
  const sizeClass = size === "sm" ? "size-7 text-[10px]" : "size-10 text-[12px]";

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2d8f98] to-[#41c8c6] font-bold text-white ${sizeClass}`}
      aria-hidden="true"
    >
      {doctorInitials(name)}
    </div>
  );
}

export default DoctorAvatar;
