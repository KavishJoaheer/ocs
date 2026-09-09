import { useEffect, useState } from "react";
import { LONG_TERM_REVIEW_EVENT, PATIENTS_LIVE_EVENT } from "../lib/inventorySync.js";

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
    window.addEventListener(LONG_TERM_REVIEW_EVENT, bump);
    const visible = () => { if (document.visibilityState === 'visible') bump(); };
    window.addEventListener('online', bump);
    window.addEventListener('focus', bump);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', bump);
      window.removeEventListener('focus', bump);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener(PATIENTS_LIVE_EVENT, bump);
      window.removeEventListener(LONG_TERM_REVIEW_EVENT, bump);
    };
  }, []);

  return refreshKey;
}
