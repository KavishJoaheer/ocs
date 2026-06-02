import { useEffect, useMemo, useRef } from "react";
import { parseMauritianID } from "../lib/nicParser.js";

/**
 * App-wide hook: when a 14-char Mauritian NIC is entered on the patient intake form,
 * derive DOB (ISO) and age for the DOB field.
 */
export function useMauritianNicPatientAutofill({ nationalId, dateOfBirth, setForm, enabled = true }) {
  const lastNicIsoRef = useRef(null);

  const nicParsed = useMemo(() => {
    if (!enabled) {
      return null;
    }
    return parseMauritianID(nationalId);
  }, [enabled, nationalId]);

  const isDobLockedFromNic = Boolean(nicParsed);
  const calculatedAge = nicParsed?.age ?? null;
  const autoFilledDob = nicParsed?.formattedDob ?? "";

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (nicParsed) {
      lastNicIsoRef.current = nicParsed.isoDob;
      setForm((current) =>
        current.date_of_birth === nicParsed.isoDob
          ? current
          : { ...current, date_of_birth: nicParsed.isoDob },
      );
      return;
    }

    const nicLength = String(nationalId || "").trim().length;
    if (
      nicLength < 14 &&
      lastNicIsoRef.current &&
      dateOfBirth === lastNicIsoRef.current
    ) {
      lastNicIsoRef.current = null;
      setForm((current) => ({ ...current, date_of_birth: "" }));
    }
  }, [enabled, nicParsed, nationalId, dateOfBirth, setForm]);

  function handleNationalIdChange(event) {
    const inputVal = String(event.target.value || "")
      .toUpperCase()
      .replace(/\s/g, "")
      .slice(0, 14);

    setForm((current) => ({ ...current, patient_id_number: inputVal }));
  }

  return {
    autoFilledDob,
    calculatedAge,
    handleNationalIdChange,
    isDobLockedFromNic,
    nicParsed,
  };
}
