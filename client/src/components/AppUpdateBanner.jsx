import { useEffect, useRef, useState } from "react";
import { CLIENT_BUILD_SHA } from "../lib/clientBuildSha.js";
import { hasUnsavedWork, subscribeUnsavedWork } from "../lib/unsavedWork.js";
import { api } from "../lib/api.js";

const POLL_MS = 60_000;
const DISMISSED_SHA_KEY = "ocs_dismissed_build_sha";

function pollInterval() {
  const override = Number(window.__OCS_UPDATE_POLL_MS || 0);
  return Number.isFinite(override) && override >= 250 ? override : POLL_MS;
}

function buildIdentity(payload) {
  return String(payload?.git_sha || payload?.version || "").trim();
}

export default function AppUpdateBanner() {
  const clientSha = CLIENT_BUILD_SHA;
  const bootShaRef = useRef(clientSha);
  const [availableSha, setAvailableSha] = useState("");
  const [dirty, setDirty] = useState(hasUnsavedWork());
  const [confirmReload, setConfirmReload] = useState(false);

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

  return (
    <div
      role="status"
      className="mb-4 flex flex-col gap-2 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950 sm:flex-row sm:items-center sm:justify-between"
    >
      <p>
        <span className="font-semibold">Update available.</span> A newer OCS release is deployed.
        {dirty
          ? " Unsaved stocktake, fulfilment, shipment or correction work is open. Reloading now can lose those counts."
          : " Reload to use the current version."}
        {confirmReload ? " Confirm reload to discard unsaved work." : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reloadNow}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2d8f98] px-3 text-sm font-bold text-white"
        >
          {dirty && !confirmReload ? "Reload requires confirmation" : confirmReload ? "Confirm reload" : "Reload now"}
        </button>
        <button
          type="button"
          onClick={() => {
            window.sessionStorage.setItem(DISMISSED_SHA_KEY, availableSha);
            setAvailableSha("");
            setConfirmReload(false);
          }}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-teal-200 bg-white px-3 text-sm font-semibold text-teal-900"
        >
          Later
        </button>
      </div>
    </div>
  );
}
