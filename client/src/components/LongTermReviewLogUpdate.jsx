export function LongTermReviewLogUpdateButton({
  onClick,
  ariaLabel,
  className = "rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-white",
  label = "Update review",
}) {
  return (
    <button type="button" aria-label={ariaLabel} onClick={onClick} className={className}>
      {label}
    </button>
  );
}
