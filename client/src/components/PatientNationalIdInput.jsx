import { cx } from "../lib/utils.js";
import { PATIENT_ID_TYPES, requiresPatientIdNumber } from "../lib/patientIdentity.js";

function PatientNationalIdInput({
  value = "",
  onChange,
  required = false,
  variant = "mobile",
  idType = "national_id",
  onTypeChange,
}) {
  const isMobile = variant === "mobile";
  const labelClass = isMobile
    ? "text-xs font-bold text-gray-700"
    : "text-sm font-semibold text-slate-700";
  const inputClass = isMobile
    ? "h-12 w-full rounded-2xl border border-slate-100 bg-gray-50 px-4 py-3 text-sm font-semibold uppercase text-slate-700 outline-none transition placeholder:text-sm placeholder:normal-case placeholder:text-gray-400 focus:border-ocs-teal focus:bg-white"
    : "w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold uppercase text-gray-800 outline-none transition placeholder:normal-case placeholder:text-gray-400 focus:border-[#557373] focus:bg-white";

  return (
    <div className="flex w-full flex-col gap-1.5">
      {onTypeChange ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="patient-id-type" className={labelClass}>ID type</label>
          <select id="patient-id-type" name="patient_id_type" value={idType} onChange={onTypeChange} className={inputClass.replace(" uppercase", "")}>
            {PATIENT_ID_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </div>
      ) : null}
      {requiresPatientIdNumber(idType) ? (
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>
            {PATIENT_ID_TYPES.find((type) => type.value === idType)?.label || "ID number"}{required ? " *" : ""}
          </span>
          <input
            type="text"
            required={required}
            maxLength={idType === "national_id" ? 14 : 100}
            name="patient_id_number"
            autoComplete="off"
            placeholder={idType === "national_id" ? "e.g., B290493310239F" : "Enter document number"}
            value={value}
            onChange={onChange}
            className={cx(inputClass)}
          />
        </label>
      ) : (
        <p className="text-xs text-slate-500">No ID number required. Date of birth and age are optional.</p>
      )}
    </div>
  );
}

export default PatientNationalIdInput;
