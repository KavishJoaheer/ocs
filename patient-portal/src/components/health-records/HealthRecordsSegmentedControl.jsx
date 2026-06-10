const TABS = [
  { id: "consultations", label: "Consultation History", mobileLabel: "Consultation History" },
  { id: "reports", label: "Medical & Lab Reports", mobileLabel: "Medical & Lab Reports" },
  { id: "clinical", label: "Clinical History", mobileLabel: "Clinical History" },
];

function HealthRecordsSegmentedControl({ activeTab, onChange, layout = "mobile" }) {
  const isDesktop = layout === "desktop";

  return (
    <div
      className={[
        "flex gap-2",
        isDesktop ? "inline-flex w-auto flex-wrap" : "mb-5 w-full overflow-x-auto",
      ].join(" ")}
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
              "cursor-pointer rounded-full border-0 py-2.5 text-[13px] transition-all duration-200 outline-none",
              isDesktop ? "shrink-0 px-4" : "shrink-0 px-3",
              isActive
                ? "bg-[#e8a020] font-semibold text-white shadow-[0_2px_10px_rgba(232,160,32,0.35)]"
                : "bg-white font-medium text-gray-600 shadow-sm ring-1 ring-black/[0.06] hover:bg-gray-50 hover:text-gray-800",
            ].join(" ")}
          >
            <span className="whitespace-nowrap">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export { TABS };
export default HealthRecordsSegmentedControl;
