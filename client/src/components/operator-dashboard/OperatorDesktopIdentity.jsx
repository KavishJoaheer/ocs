import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { cx } from "../../lib/utils.js";
import {
  getOperatorDisplayName,
  getOperatorInitials,
  isOperatorLive,
} from "./operatorDashboardCopy.js";
import "./operatorDashboard.css";

function OperatorDesktopIdentity({ user, onSignOut }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const menuId = useId();
  const displayName = getOperatorDisplayName(user);
  const initials = getOperatorInitials(user);
  const live = isOperatorLive(user?.operation_status);
  const statusLabel = live ? "Active" : "Offline";

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="ocs-cc-identity relative mt-5 px-3 py-3" ref={rootRef}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-[#203f42] font-display text-sm font-semibold text-white"
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-semibold text-[#203f42]" title={user?.full_name || displayName}>
            {displayName}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-[#5f7476]">
            <span>Operator</span>
            <span aria-hidden="true">·</span>
            <span
              className={cx(
                "inline-block size-1.5 rounded-full",
                live ? "bg-[#2bccc4]" : "bg-[#ff5f4a]",
              )}
              aria-hidden="true"
            />
            <span>{statusLabel}</span>
          </p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="menu"
          aria-controls={menuId}
          onClick={() => setOpen((current) => !current)}
          className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-[#203f42] transition hover:bg-[rgba(32,63,66,0.08)]"
          aria-label={`Open account menu for ${displayName}`}
        >
          Account
          <ChevronDown className={cx("size-4 transition-transform duration-200", open && "rotate-180")} />
        </button>
      </div>

      {open ? (
        <div className="ocs-cc-identity-menu" id={menuId} role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut?.();
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-[#203f42] transition hover:bg-[#f3f7f4]"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default OperatorDesktopIdentity;
