import { useCallback, useEffect, useMemo, useState } from "react";
import { buildInventoryListQuery } from "../lib/inventoryFolders.js";
import { buildDoctorInventoryNotifications } from "../lib/doctorInventoryAlerts.js";
import { DOCTOR_BAG_INVENTORY_EVENT } from "../lib/inventorySync.js";
import { api } from "../lib/api.js";

export function useDoctorBagInventory({ enabled = true } = {}) {
  const [bagItems, setBagItems] = useState([]);
  const [loading, setLoading] = useState(Boolean(enabled));

  const loadBagInventory = useCallback(async () => {
    if (!enabled) {
      setBagItems([]);
      setLoading(false);
      return;
    }

    try {
      const query = buildInventoryListQuery({
        doctorContext: "my",
        includeDoctorContext: true,
      });
      const payload = await api.get(`/inventory${query}`);
      setBagItems(Array.isArray(payload?.my_stock) ? payload.my_stock : []);
    } catch {
      setBagItems([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    loadBagInventory();
  }, [loadBagInventory]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const handleRefresh = () => {
      void loadBagInventory();
    };

    window.addEventListener(DOCTOR_BAG_INVENTORY_EVENT, handleRefresh);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void loadBagInventory();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener(DOCTOR_BAG_INVENTORY_EVENT, handleRefresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, loadBagInventory]);

  const notifications = useMemo(
    () => buildDoctorInventoryNotifications(bagItems),
    [bagItems],
  );

  const hasLowStockAlert = useMemo(
    () => notifications.some((alert) => alert.tone === "rose"),
    [notifications],
  );

  return {
    bagItems,
    loading,
    notifications,
    alertCount: notifications.length,
    hasLowStockAlert,
    reload: loadBagInventory,
  };
}
