import { useCallback, useEffect, useMemo, useState } from "react";
import { buildInventoryListQuery } from "../lib/inventoryFolders.js";
import { countDoctorBagLowStock, doctorBagReadiness } from "../lib/doctorInventoryAlerts.js";
import { DOCTOR_BAG_INVENTORY_EVENT } from "../lib/inventorySync.js";
import { api } from "../lib/api.js";

export function useDoctorBagInventory({ enabled = true } = {}) {
  const [bagItems, setBagItems] = useState([]);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);

  const loadBagInventory = useCallback(async () => {
    if (!enabled) {
      setBagItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const query = buildInventoryListQuery({
        doctorContext: "my",
        includeDoctorContext: true,
      });
      const payload = await api.get(`/inventory${query}`);
      setBagItems(Array.isArray(payload?.my_stock) ? payload.my_stock : []);
    } catch (err) {
      setBagItems([]);
      setError(err.message || "Could not load bag stock.");
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

  const lowStockCount = useMemo(() => countDoctorBagLowStock(bagItems), [bagItems]);
  const readiness = useMemo(() => doctorBagReadiness(bagItems), [bagItems]);

  return {
    bagItems,
    loading,
    error,
    lowStockCount,
    readiness,
    hasLowStockAlert: lowStockCount > 0,
    reload: loadBagInventory,
  };
}
