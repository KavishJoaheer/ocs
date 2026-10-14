import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

export function useOperationalTaskCount(user) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!["admin", "operator", "doctor", "lab_tech"].includes(user?.role)) return;
    let active = true;
    let requestId = 0;
    async function load() {
      const id = ++requestId;
      try { const result = await api.get("/operational-tasks/summary"); if (active && id === requestId) setCount(result.open); }
      catch { /* The inbox itself shows failures and offers retry. */ }
    }
    void load();
    const timer = setInterval(load, 30000);
    const events = ["focus", "online", "ocs-actions-updated"];
    events.forEach(event => window.addEventListener(event, load));
    return () => { active = false; clearInterval(timer); events.forEach(event => window.removeEventListener(event, load)); };
  }, [user?.id, user?.role]);
  return count;
}
