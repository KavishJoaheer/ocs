import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { SUPPLY_REQUESTS_EVENT } from "../lib/inventorySync.js";

export function useOperatorSupplyCount(enabled) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let ignore = false;
    let latest = 0;
    async function load() {
      const sequence = ++latest;
      try {
        const payload = await api.get("/restock-requests/queues");
        if (!ignore && sequence === latest) setCount(Number(payload?.counts?.unique_requests || 0));
      } catch {
        // A temporary failure keeps the last known count until the next refresh.
      }
    }
    void load();
    window.addEventListener(SUPPLY_REQUESTS_EVENT, load);
    const timer = window.setInterval(load, 30000);
    return () => {
      ignore = true;
      window.removeEventListener(SUPPLY_REQUESTS_EVENT, load);
      window.clearInterval(timer);
    };
  }, [enabled]);
  return enabled ? count : 0;
}
