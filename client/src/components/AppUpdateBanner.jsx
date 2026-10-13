import { useEffect, useRef, useState } from "react";
import { CLIENT_BUILD_SHA } from "../lib/clientBuildSha.js";
import { hasUnsavedWork, subscribeUnsavedWork } from "../lib/unsavedWork.js";
import { api } from "../lib/api.js";
import { RefreshCw } from "lucide-react";
import Modal from "./Modal.jsx";

const POLL_MS = 60_000;
const DISMISSED_SHA_KEY = "ocs_dismissed_build_sha";

function pollInterval() {
  const override = Number(window.__OCS_UPDATE_POLL_MS || 0);
  return Number.isFinite(override) && override >= 250 ? override : POLL_MS;
}

function buildIdentity(payload) {
  return String(payload?.git_sha || payload?.version || "").trim();
}

export default function AppUpdateBanner({ compact = false }) {
  const clientSha = CLIENT_BUILD_SHA;
  const bootShaRef = useRef(clientSha);
  const [availableSha, setAvailableSha] = useState("");
  const [dirty, setDirty] = useState(hasUnsavedWork());
  const [confirmReload, setConfirmReload] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => subscribeUnsavedWork(setDirty), []);

  useEffect(() => {
    bootShaRef.current = clientSha;
    if (typeof window !== "undefined") {
      window.__OCS_CLIENT_BUILD_SHA__ = clientSha;
    }
  }, [clientSha]);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const payload = await api.get("/health");
        const identity = buildIdentity(payload);
        if (!identity || cancelled) return;
        const local = bootShaRef.current || clientSha;
        if (local && identity !== local) {
          const dismissed = window.sessionStorage.getItem(DISMISSED_SHA_KEY);
          if (dismissed !== identity) setAvailableSha(identity);
        } else if (identity === local) {
          setAvailableSha("");
        }
      } catch {
        /* offline or health unavailable must not loop-reload */
      }
    }
    void check();
    const timer = window.setInterval(() => void check(), pollInterval());
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [clientSha]);

  if (!availableSha) return null;

  function reloadNow() {
    if (dirty && !confirmReload) {
      setConfirmReload(true);
      return;
    }
    window.sessionStorage.setItem(DISMISSED_SHA_KEY, availableSha);
    window.location.reload();
  }

  function dismiss() {
    window.sessionStorage.setItem(DISMISSED_SHA_KEY, availableSha);
    setAvailableSha("");
    setConfirmReload(false);
    setOpen(false);
  }

  if (compact) {
    return <>
      <button type="button" onClick={() => setOpen(true)} aria-label="App update available" title="App update available" className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[#d5e4e1] bg-white text-[#376168]">
        <RefreshCw className="size-4" aria-hidden="true" /><span className="absolute right-1 top-1 size-2.5 rounded-full border-2 border-white bg-[#20c9c0]" aria-hidden="true" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="App update available" size="sm">
        <p className="text-sm leading-6 text-[#485e65]">A newer OCS release is available.{dirty ? " Unsaved work is open. Reloading can lose your changes." : " Reload to use the current version."}{confirmReload ? " Confirm reload to discard unsaved work." : ""}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={reloadNow} aria-label={dirty && !confirmReload ? "Reload requires confirmation" : confirmReload ? "Confirm reload" : "Reload now"} className="min-h-11 rounded-full bg-[#137b80] px-4 py-2 text-sm font-semibold text-white">{dirty && !confirmReload ? "Review" : confirmReload ? "Confirm" : "Reload"}</button>
          <button type="button" onClick={dismiss} className="min-h-11 rounded-full border border-[#d5e4e1] bg-white px-4 py-2 text-sm font-semibold text-[#376168]">Later</button>
        </div>
      </Modal>
    </>;
  }

  return (
    <div
      role="status"
      className="mb-1.5 flex items-center justify-between gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs text-teal-950 sm:mb-3 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm"
    >
      <p className="min-w-0 truncate sm:overflow-visible sm:whitespace-normal">
        <span className="font-semibold">Update available.</span>
        <span className="hidden sm:inline"> A newer OCS release is deployed.
          {dirty
            ? " Unsaved stock count, fulfilment, bulk delivery or correction work is open. Reloading now can lose those counts."
            : " Reload to use the current version."}
          {confirmReload ? " Confirm reload to discard unsaved work." : ""}
        </span>
      </p>
      <div className="flex shrink-0 gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={reloadNow}
          aria-label={dirty && !confirmReload ? "Reload requires confirmation" : confirmReload ? "Confirm reload" : "Reload now"}
          className="inline-flex min-h-9 items-center justify-center rounded-lg bg-[#2d8f98] px-2.5 text-xs font-bold text-white sm:min-h-11 sm:rounded-xl sm:px-3 sm:text-sm"
        >
          {dirty && !confirmReload ? "Review" : confirmReload ? "Confirm" : "Reload"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex min-h-9 items-center justify-center rounded-lg border border-teal-200 bg-white px-2.5 text-xs font-semibold text-teal-900 sm:min-h-11 sm:rounded-xl sm:px-3 sm:text-sm"
        >
          Later
        </button>
      </div>
    </div>
  );
}
