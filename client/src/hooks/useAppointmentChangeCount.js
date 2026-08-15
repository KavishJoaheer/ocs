import { useEffect, useState } from "react";
import { useAuth } from "./useAuth.jsx";
import { useLiveRefreshKey } from "./useLiveRefreshKey.js";
import { api } from "../lib/api.js";

export function useAppointmentChangeCount() {
  const { user } = useAuth();
  const refreshKey = useLiveRefreshKey();
  const [count, setCount] = useState(0);
  const enabled = user?.role === "admin" || user?.role === "operator";

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let ignore = false;

    async function load() {
      try {
        const payload = await api.get("/appointment-change-requests?status=pending");
        if (!ignore) {
          setCount((payload.requests || []).length);
        }
      } catch {
        if (!ignore) {
          setCount(0);
        }
      }
    }

    void load();
    return () => {
      ignore = true;
    };
  }, [enabled, refreshKey]);

  return enabled ? count : 0;
}
