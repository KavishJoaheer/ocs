import { RefreshCw } from "lucide-react";
import AppUpdateBanner from "../AppUpdateBanner.jsx";
import PushNotificationBanner from "../PushNotificationBanner.jsx";
import { cx } from "../../lib/utils.js";

export default function InventoryWorkspaceHeader({ title, actions, role, refreshing, onRefresh, workspaceLabel = "Inventory workspace", refreshLabel = "Refresh inventory" }) {
  return <header className="inventory-workspace-header flex flex-wrap items-center justify-between gap-4 rounded-[28px] bg-gradient-to-r from-[#e3f5f0] via-[#eef9f5] to-[#fff9ed] px-6 py-5">
    <div className="min-w-0"><p className="text-xs font-semibold text-[#137b80]">{workspaceLabel}</p><h1 className="mt-1 break-words text-3xl font-bold tracking-tight text-[#173f4a]">{title}</h1></div>
    <div className="flex flex-wrap items-center gap-3">{actions}<div className="flex items-center gap-1"><PushNotificationBanner compact role={role} /><AppUpdateBanner compact /><button type="button" aria-label={refreshLabel} disabled={refreshing} onClick={onRefresh} className="inline-flex size-11 items-center justify-center rounded-full border border-[#d5e4e1] bg-white text-[#376168] disabled:opacity-50"><RefreshCw aria-hidden="true" className={cx("size-4", refreshing && "animate-spin")} /></button></div></div>
  </header>;
}
