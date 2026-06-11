export const URGENCY_LEVELS = ["routine", "urgent", "emergency"];

export const URGENCY_META = {
  routine: {
    label: "Routine",
    // selected state on the form toggle
    selected: "bg-[#2d8f98] text-white shadow-[0_10px_24px_rgba(45,143,152,0.28)]",
    // small coloured pill (review / tracking)
    pill: "bg-[rgba(45,143,152,0.12)] text-[#23767f]",
  },
  urgent: {
    label: "Urgent",
    selected: "bg-brand-gold text-brand-dark-grey shadow-[0_10px_24px_rgba(var(--ocs-brand-gold-rgb),0.3)]",
    pill: "bg-brand-gold/15 text-brand-gold-dark",
  },
  emergency: {
    label: "Emergency",
    selected: "bg-[#e2574c] text-white shadow-[0_10px_24px_rgba(226,87,76,0.28)]",
    pill: "bg-[rgba(226,87,76,0.12)] text-[#c23a2f]",
  },
};

export const URGENCY_UNSELECTED =
  "bg-[rgba(100,116,139,0.07)] text-[#5b7f8a] hover:bg-[rgba(100,116,139,0.12)]";
