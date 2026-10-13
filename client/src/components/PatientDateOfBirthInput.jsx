import { useState } from "react";
import { cx } from "../lib/utils.js";
import {
  calculateAgeFromDobMask,
  isoToDobDisplayMask,
  maskDigitsToDobDisplay,
  parseDobMaskToIso,
} from "../lib/patientDobInput.js";

function PatientDateOfBirthInput({
  value = "",
  onChange,
  resetKey = "new",
  open = true,
  required = false,
  variant = "mobile",
  nicAutofill = null,
  nationalIdSelected = true,
  manualAge = "",
  onAgeChange,
}) {
  const [rawDobInput, setRawDobInput] = useState(() => isoToDobDisplayMask(value));
  const [calculatedAge, setCalculatedAge] = useState(() => calculateAgeFromDobMask(isoToDobDisplayMask(value)));
  const [emittedValue, setEmittedValue] = useState(value);

  const lockedFromNic = Boolean(nicAutofill);
  const displayAge = lockedFromNic ? nicAutofill.age : calculatedAge;
  const displayDob = lockedFromNic ? nicAutofill.formattedDob : rawDobInput;

  const isMobile = variant === "mobile";
  const labelClass = isMobile
    ? "text-xs font-bold text-gray-700"
    : "text-sm font-semibold text-slate-700";
  const inputClass = isMobile
    ? "h-12 w-full rounded-2xl px-4 py-3 text-sm font-semibold outline-none transition placeholder:text-sm"
    : "w-full rounded-xl px-4 py-3 text-sm font-semibold outline-none transition";
  const manualInputClass = cx(
    inputClass,
    isMobile
      ? "border border-slate-100 bg-gray-50 text-slate-700 placeholder:text-gray-400 focus:border-ocs-teal focus:bg-white"
      : "border border-gray-200 bg-gray-50 text-gray-800 placeholder:text-gray-400 focus:border-[#557373] focus:bg-white",
  );
  const nicLockedInputClass = cx(
    inputClass,
    "border border-emerald-200/60 bg-emerald-50/40 font-bold text-emerald-900",
  );

  const [syncedDeps, setSyncedDeps] = useState({ open, resetKey, value, lockedFromNic });

  if (
    syncedDeps.open !== open ||
    syncedDeps.resetKey !== resetKey ||
    syncedDeps.value !== value ||
    syncedDeps.lockedFromNic !== lockedFromNic
  ) {
    setSyncedDeps({ open, resetKey, value, lockedFromNic });

    if (open && !lockedFromNic && (value !== emittedValue || syncedDeps.resetKey !== resetKey || syncedDeps.open !== open || syncedDeps.lockedFromNic !== lockedFromNic)) {
      const masked = isoToDobDisplayMask(value);
      setRawDobInput((current) => (current === masked ? current : masked));
      setCalculatedAge(masked.length === 10 ? calculateAgeFromDobMask(masked) : null);
    }
  }

  function handleDobMasking(event) {
    if (lockedFromNic) {
      return;
    }

    const masked = maskDigitsToDobDisplay(event.target.value);
    setRawDobInput(masked);

    if (masked.length === 10) {
      const iso = parseDobMaskToIso(masked);
      event.target.setCustomValidity(iso ? "" : "Enter a valid date of birth.");
      const age = calculateAgeFromDobMask(masked);
      setCalculatedAge(age);
      setEmittedValue(iso || "");
      onChange?.(iso || "");
    } else {
      event.target.setCustomValidity("");
      setCalculatedAge(null);
      setEmittedValue("");
      onChange?.("");
    }
  }

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="patient-date-of-birth" className={labelClass}>Date of Birth{required ? " *" : ""}</label>
        {nationalIdSelected && displayAge !== null ? (
          <span className="animate-fade-in text-xs font-extrabold text-[#557373]">
            🟢 Age: {displayAge} years old
          </span>
        ) : null}
      </div>

      <div className="relative">
        <input
          id="patient-date-of-birth"
          type="text"
          required={required}
          pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}"
          readOnly={lockedFromNic}
          inputMode={lockedFromNic ? "text" : "numeric"}
          maxLength={lockedFromNic ? undefined : 10}
          name="date_of_birth_display"
          autoComplete="bday"
          placeholder={lockedFromNic ? nicAutofill.formattedDob : "DD / MM / YYYY"}
          value={displayDob}
          onChange={handleDobMasking}
          className={lockedFromNic ? nicLockedInputClass : manualInputClass}
        />
      </div>
      {!nationalIdSelected && onAgeChange ? (
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Age (years)</span>
          <input type="number" name="manual_age" min="0" step="1" value={manualAge}
            onChange={onAgeChange} placeholder="Enter age (optional)" className={manualInputClass} />
        </label>
      ) : null}
      {!lockedFromNic ? (
        <p className="text-[11px] font-medium text-gray-400">
          {nationalIdSelected
            ? "Auto-filled from National ID when a valid 14-character NIC is entered."
            : "Enter date of birth and age manually if known. Both are optional."}
        </p>
      ) : null}
    </div>
  );
}

export default PatientDateOfBirthInput;
