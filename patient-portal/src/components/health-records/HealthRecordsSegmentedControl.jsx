const TABS = [
  { id: "consultations", label: "Consultations", mobileLabel: "Consultations" },
  { id: "reports", label: "Reports", mobileLabel: "Reports" },
  { id: "clinical", label: "Clinical History", mobileLabel: "Clinical" },
];

function HealthRecordsSegmentedControl({ activeTab, onChange, layout = "mobile" }) {
  const isDesktop = layout === "desktop";

  return (
    <div
      className={["flex gap-2", isDesktop ? "flex-wrap" : "mb-5 w-full"].join(" ")}
      role="tablist"
      aria-label="Health records sections"
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={[
              "cursor-pointer rounded-full border-0 px-4 py-2.5 text-[13px] whitespace-nowrap transition-all duration-200 outline-none",
              isDesktop ? "" : "flex-1",
              isActive
                ? "bg-[#e8a020] font-semibold text-white shadow-[0_2px_10px_rgba(232,160,32,0.35)]"
                : "bg-white font-medium text-gray-600 shadow-sm ring-1 ring-black/[0.06] hover:bg-gray-50 hover:text-gray-800",
            ].join(" ")}
          >
            {isDesktop ? tab.label : tab.mobileLabel}
          </button>
        );
      })}
    </div>
  );
}

export { TABS };
export default HealthRecordsSegmentedControl;
