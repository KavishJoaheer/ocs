import { useEffect, useState } from "react";
import { isPatientRealtimeConnected, PATIENT_DATA_EVENT } from "../lib/realtime.js";

const POLL_INTERVAL_MS = 60000;

/**
 * Returns a counter that increments whenever the patient realtime stream
 * reports a server-side change. Add it to a data-loading effect's dependency
 * array so the page refetches live:
 *
 *   const refreshKey = useLiveRefreshKey();
 *   useEffect(() => { load(); }, [refreshKey]);
 */
export function useLiveRefreshKey() {
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const bump = () => setRefreshKey((value) => value + 1);
    window.addEventListener(PATIENT_DATA_EVENT, bump);
    return () => window.removeEventListener(PATIENT_DATA_EVENT, bump);
  }, []);

  useEffect(() => {
    const poll = window.setInterval(() => {
      if (!isPatientRealtimeConnected()) {
        setRefreshKey((value) => value + 1);
      }
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(poll);
  }, []);

  return refreshKey;
}
