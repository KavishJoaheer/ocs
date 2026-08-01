export function LongTermReviewLogUpdateButton({
  onClick,
  className = "rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-white",
  label = "📝 Log Update",
}) {
  return (
    <button type="button" onClick={onClick} className={className}>
      {label}
    </button>
  );
}
