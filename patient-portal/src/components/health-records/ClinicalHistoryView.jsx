import {
  filterClinicalItems,
  formatIsoDatesInText,
  formatMedicalConditionName,
  getClinicalEmptyMessage,
  isNilAllergyValue,
} from "../../lib/healthRecordsDisplay.js";

const SECTIONS = [
  { key: "medical_history", title: "Past Medical History" },
  { key: "surgical_history", title: "Past Surgical History" },
  { key: "drug_history", title: "Drug History" },
  { key: "allergy_history", title: "Allergy History", isAllergy: true },
];

function formatSectionValue(section, items) {
  const visibleItems = filterClinicalItems(items);

  if (visibleItems.length === 0) {
    return {
      primary: getClinicalEmptyMessage(section.key),
      details: [],
      isEmpty: true,
      hasAllergyWarning: false,
    };
  }

  const hasAllergyWarning =
    section.isAllergy && visibleItems.some((item) => !isNilAllergyValue(item.name));

  return {
    primary: visibleItems.map((item) => formatMedicalConditionName(item.name)).join(", "),
    details: visibleItems
      .map((item) => (item.detail ? formatIsoDatesInText(item.detail) : null))
      .filter(Boolean),
    isEmpty: false,
    hasAllergyWarning,
  };
}

function ClinicalHistoryView({ clinicalHistory }) {
  return (
    <div aria-label="Clinical history">
      <p className="mb-4 block w-full text-left text-[12px] italic text-gray-500">
        Read only · Maintained by your OCS doctor
      </p>

      <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
        {SECTIONS.map((section) => {
          const value = formatSectionValue(section, clinicalHistory[section.key] ?? []);

          return (
            <div
              key={section.key}
              className="p-4 border-b border-gray-100 last:border-b-0"
            >
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                {section.title}
              </p>
              <p
                className={[
                  "text-[15px]",
                  value.isEmpty
                    ? "italic text-gray-400"
                    : value.hasAllergyWarning
                      ? "text-[#c45c3e]"
                      : "text-gray-900",
                ].join(" ")}
              >
                {value.primary}
              </p>
              {value.details.length > 0 ? (
                <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
                  {value.details.join(" · ")}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ClinicalHistoryView;
