import { Navigate, useLocation } from "react-router-dom";
import OperatorWorkQueuesPanel from "../components/OperatorWorkQueuesPanel.jsx";
import InventoryWorkspaceHeader from "../components/inventory/InventoryWorkspaceHeader.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { notifySupplyRequestsUpdated } from "../lib/inventorySync.js";
import "../components/supply-requests/supplyWorkspace.css";

export default function OperatorSupplyRequestsPage() {
  const compact = useIsMobile(1024);
  const { search } = useLocation();
  if (compact) {
    const params = new URLSearchParams(search);
    params.set("tab", "queues");
    return <Navigate to={`/inventory?${params}`} replace />;
  }

  return (
    <section className="supply-workspace w-full space-y-4">
      <InventoryWorkspaceHeader title="Supply requests" workspaceLabel="Supply workspace"
        refreshLabel="Refresh supply requests" role="operator" onRefresh={notifySupplyRequestsUpdated} />
      <OperatorWorkQueuesPanel workspace="supply" />
    </section>
  );
}
