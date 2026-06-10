import { Lock, Pill, Scissors, ShieldAlert, Stethoscope } from "lucide-react";
import {
  filterClinicalItems,
  formatIsoDatesInText,
  formatMedicalConditionName,
  getClinicalEmptyMessage,
  isNilAllergyValue,
} from "../../lib/healthRecordsDisplay.js";

const SECTIONS = [
  {
    key: "medical_history",
    title: "Past Medical History",
    icon: Stethoscope,
  },
  {
    key: "surgical_history",
    title: "Past Surgical History",
    icon: Scissors,
  },
  {
    key: "drug_history",
    title: "Drug History",
    icon: Pill,
  },
  {
    key: "allergy_history",
    title: "Allergy History",
    icon: ShieldAlert,
    isAllergy: true,
  },
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
    primary: visibleItems.map((item) => formatMedicalConditionName(item.name)).join(" · "),
    details: visibleItems
      .map((item) => (item.detail ? formatIsoDatesInText(item.detail) : null))
      .filter(Boolean),
    isEmpty: false,
    hasAllergyWarning,
  };
}

function ClinicalHistoryTile({ section, value }) {
  const Icon = section.icon;

  return (
    <article className="mb-4 overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm last:mb-0 lg:mb-0 lg:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 lg:h-10 lg:w-10">
          <Icon className="size-[17px] lg:size-[18px]" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 lg:text-[11px]">
            {section.title}
          </p>
          <p
            className={[
              "mt-2 text-[15px] font-medium leading-relaxed lg:mt-3 lg:text-[16px]",
              value.isEmpty
                ? "font-normal italic text-gray-400"
                : "text-gray-900",
              !value.isEmpty && value.hasAllergyWarning ? "text-[#c45c3e]" : "",
            ].join(" ")}
          >
            {value.primary}
          </p>
          {value.details.length > 0 ? (
            <p className="mt-2 text-[13px] leading-relaxed text-gray-500">
              {value.details.join(" · ")}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ClinicalHistoryView({ clinicalHistory }) {
  return (
    <div className="font-sans" aria-label="Clinical history">
      <div className="mb-4 flex justify-start lg:mb-6 lg:justify-end">
        <p className="flex items-center gap-1 text-[11px] italic text-gray-400 lg:not-italic lg:font-medium lg:text-[12px]">
          <Lock className="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
          Read only · Maintained by your OCS doctor
        </p>
      </div>

      <div className="flex flex-col lg:grid lg:grid-cols-2 lg:gap-6">
        {SECTIONS.map((section) => (
          <ClinicalHistoryTile
            key={section.key}
            section={section}
            value={formatSectionValue(section, clinicalHistory[section.key] ?? [])}
          />
        ))}
      </div>
    </div>
  );
}

export default ClinicalHistoryView;
