import { useEffect, useState } from "react";
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
}) {
  const [rawDobInput, setRawDobInput] = useState("");
  const [calculatedAge, setCalculatedAge] = useState(null);

  const isMobile = variant === "mobile";
  const labelClass = isMobile
    ? "text-xs font-bold text-gray-700"
    : "text-sm font-semibold text-slate-700";
  const inputClass = isMobile
    ? "h-12 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-800 outline-none transition placeholder:text-sm placeholder:text-gray-400 focus:border-[#557373] focus:bg-white"
    : "w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#557373] focus:bg-white";

  useEffect(() => {
    if (!open) {
      return;
    }

    const masked = isoToDobDisplayMask(value);
    setRawDobInput(masked);
    setCalculatedAge(masked.length === 10 ? calculateAgeFromDobMask(masked) : null);
  }, [open, resetKey]);

  useEffect(() => {
    if (!open || !value) {
      return;
    }

    const masked = isoToDobDisplayMask(value);
    setRawDobInput((current) => (current === masked ? current : masked));
    setCalculatedAge(calculateAgeFromDobMask(masked));
  }, [open, value]);

  function handleDobMasking(event) {
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
        <label className={labelClass}>
          Date of Birth{required ? " *" : ""}
        </label>
        {calculatedAge !== null ? (
          <span className="animate-fade-in text-xs font-extrabold text-[#557373]">
            🟢 Age: {calculatedAge} years old
          </span>
        ) : null}
      </div>

      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          maxLength={10}
          name="date_of_birth_display"
          autoComplete="bday"
          placeholder="DD / MM / YYYY"
          value={rawDobInput}
          onChange={handleDobMasking}
          className={cx(inputClass)}
        />
      </div>
    </div>
  );
}

export default PatientDateOfBirthInput;
