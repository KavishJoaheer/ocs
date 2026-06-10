import {
  filterClinicalItems,
  formatIsoDatesInText,
  formatMedicalConditionName,
  getClinicalEmptyMessage,
  isNilAllergyValue,
} from "../../lib/healthRecordsDisplay.js";
import { NativeGroupedFooter, NativeGroupedList } from "../native/NativeGroupedList.jsx";

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
      <NativeGroupedList>
        {SECTIONS.map((section, idx) => {
          const value = formatSectionValue(section, clinicalHistory[section.key] ?? []);

          return (
            <div
              key={section.key}
              className={[
                "px-4 py-3",
                idx < SECTIONS.length - 1 ? "border-b border-gray-100" : "",
              ].join(" ")}
            >
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                {section.title}
              </p>
              <p
                className={[
                  "mt-1 text-[15px] leading-snug",
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
      </NativeGroupedList>

      <NativeGroupedFooter>
        Read only · Maintained by your OCS doctor
      </NativeGroupedFooter>
    </div>
  );
}

export default ClinicalHistoryView;
