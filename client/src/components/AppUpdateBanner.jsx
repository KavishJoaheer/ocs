import { useEffect, useRef, useState } from "react";
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
  const bootShaRef = useRef("");
  const [availableSha, setAvailableSha] = useState("");
  const [dirty, setDirty] = useState(hasUnsavedWork());

  useEffect(() => subscribeUnsavedWork(setDirty), []);

  useEffect(() => {
    let cancelled = false;
    async function check(initial = false) {
      try {
        const payload = await api.get("/health");
        const identity = buildIdentity(payload);
        if (!identity || cancelled) return;
        if (initial && !bootShaRef.current) {
          bootShaRef.current = identity;
          return;
        }
        if (bootShaRef.current && identity !== bootShaRef.current) {
          const dismissed = window.sessionStorage.getItem(DISMISSED_SHA_KEY);
          if (dismissed !== identity) setAvailableSha(identity);
        }
      } catch {
        /* offline or health unavailable must not loop-reload */
      }
    }
    void check(true);
    const timer = window.setInterval(() => void check(false), pollInterval());
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!availableSha) return null;

  function reloadNow() {
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
        {dirty ? " Finish or save the open form before reloading so counts and fulfilment are not lost." : " Reload to use the current version."}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reloadNow}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2d8f98] px-3 text-sm font-bold text-white"
        >
          Reload now
        </button>
        <button
          type="button"
          onClick={() => {
            window.sessionStorage.setItem(DISMISSED_SHA_KEY, availableSha);
            setAvailableSha("");
          }}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-teal-200 bg-white px-3 text-sm font-semibold text-teal-900"
        >
          Later
        </button>
      </div>
    </div>
  );
}
