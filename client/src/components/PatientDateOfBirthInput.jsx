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
}) {
  const [rawDobInput, setRawDobInput] = useState("");
  const [calculatedAge, setCalculatedAge] = useState(null);

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
      ? "border border-gray-200 bg-gray-50 text-gray-800 placeholder:text-gray-400 focus:border-[#557373] focus:bg-white"
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

    if (open && !lockedFromNic) {
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
      const age = calculateAgeFromDobMask(masked);
      setCalculatedAge(age);
      onChange?.(iso || "");
    } else {
      setCalculatedAge(null);
      onChange?.("");
    }
  }

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className={labelClass}>Date of Birth{required ? " *" : ""}</label>
        {displayAge !== null ? (
          <span className="animate-fade-in text-xs font-extrabold text-[#557373]">
            🟢 Age: {displayAge} years old
          </span>
        ) : null}
      </div>

      <div className="relative">
        <input
          type="text"
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
      {!lockedFromNic ? (
        <p className="text-[11px] font-medium text-gray-400">
          Auto-filled from National ID when a valid 14-character NIC is entered.
        </p>
      ) : null}
    </div>
  );
}

export default PatientDateOfBirthInput;
