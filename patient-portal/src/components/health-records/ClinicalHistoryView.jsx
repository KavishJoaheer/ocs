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
    <article className="flex flex-col justify-between overflow-hidden rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-50 text-teal-600">
            <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <p className="text-[11px] font-bold tracking-wider text-gray-400 uppercase">
            {section.title}
          </p>
        </div>

        <p
          className={[
            value.isEmpty
              ? "text-[15px] font-normal italic leading-relaxed text-gray-400"
              : "text-[16px] font-medium leading-relaxed text-gray-900",
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
    </article>
  );
}

function ClinicalHistoryView({ clinicalHistory }) {
  return (
    <div aria-label="Clinical history">
      <div className="mb-4 flex justify-end lg:mb-6">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-gray-400">
          <Lock className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
          Read only · Maintained by your OCS doctor
        </p>
      </div>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:gap-6">
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
