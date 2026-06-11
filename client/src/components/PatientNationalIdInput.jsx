import { cx } from "../lib/utils.js";

function PatientNationalIdInput({
  value = "",
  onChange,
  required = false,
  variant = "mobile",
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
      <label className={labelClass}>National ID Number{required ? " *" : ""}</label>
      <input
        type="text"
        maxLength={14}
        name="patient_id_number"
        autoComplete="off"
        placeholder="e.g., B290493310239F"
        value={value}
        onChange={onChange}
        className={cx(inputClass)}
      />
    </div>
  );
}

export default PatientNationalIdInput;
