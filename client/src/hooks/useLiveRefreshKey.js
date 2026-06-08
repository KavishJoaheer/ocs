import { useEffect, useState } from "react";
import { PATIENTS_LIVE_EVENT } from "../lib/inventorySync.js";

/**
 * Returns a counter that increments whenever the realtime stream reports a
 * cross-portal patient change (record, appointment, consultation, bill, lab
 * report — from the patient, another staff member, or the insurer). Add it to a
 * data-loading effect's dependency array so the view refreshes live:
 *
 *   const refreshKey = useLiveRefreshKey();
 *   useEffect(() => { load(); }, [refreshKey]);
 */
export function useLiveRefreshKey() {
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const bump = () => setRefreshKey((value) => value + 1);
    window.addEventListener(PATIENTS_LIVE_EVENT, bump);
    return () => window.removeEventListener(PATIENTS_LIVE_EVENT, bump);
  }, []);

  return refreshKey;
}
