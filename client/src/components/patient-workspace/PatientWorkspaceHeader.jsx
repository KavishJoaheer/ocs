import { RefreshCw } from "lucide-react";
import AppUpdateBanner from "../AppUpdateBanner.jsx";
import PushNotificationBanner from "../PushNotificationBanner.jsx";
import { cx } from "../../lib/utils.js";
import "./patientWorkspace.css";

export default function PatientWorkspaceHeader({ title, subtitle, role, actions, children, onRefresh, refreshing }) {
  return (
    <header className="patient-workspace-header rounded-[28px] bg-gradient-to-r from-[#e3f5f0] via-[#eef9f5] to-[#fff9ed] p-4 sm:px-6 sm:py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-xl font-bold tracking-tight text-[#173f4a] sm:text-3xl">{title}</h1>
          {subtitle ? <p className="mt-1 break-words text-xs text-[#376168] sm:text-sm">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <PushNotificationBanner compact role={role} />
          <AppUpdateBanner compact />
          {onRefresh ? (
            <button type="button" aria-label="Refresh patient workspace" disabled={refreshing} onClick={onRefresh} className="patient-icon-control">
              <RefreshCw aria-hidden="true" className={cx("size-4", refreshing && "animate-spin")} />
            </button>
          ) : null}
        </div>
      </div>
      {children || actions ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
          <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>
        </div>
      ) : null}
    </header>
  );
}
