import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  PushPermissionDeniedError,
  fetchPushConfiguration,
  getPushPermissionRecoveryInstructions,
  getPushPermissionState,
  isPushNotificationsEnabled,
  isPushSupported,
  subscribeToPushNotifications,
  unsubscribeFromPushNotifications,
} from "../lib/pushNotifications.js";

function PushNotificationToggle({ className = "", alwaysShow = false, role = null, variant = "light" }) {
  const onDark = variant === "onDark";
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(false);
  const [permission, setPermission] = useState("unsupported");
  const [isUpdating, setIsUpdating] = useState(false);
  const [showDeniedGuide, setShowDeniedGuide] = useState(false);
  const recovery = getPushPermissionRecoveryInstructions();

  const refreshState = useCallback(async () => {
    if (!isPushSupported()) {
      setAvailable(false);
      setEnabled(false);
      setPermission("unsupported");
      return;
    }

    const nextPermission = await getPushPermissionState();
    setPermission(nextPermission);

    const { configured } = await fetchPushConfiguration();
    if (!configured) {
      setAvailable(false);
      setEnabled(false);
      return;
    }

    setAvailable(true);

    if (nextPermission !== "granted") {
      setEnabled(false);
      return;
    }

    setEnabled(await isPushNotificationsEnabled());
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshState();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [refreshState]);

  if (!alwaysShow && !available) {
    return null;
  }

  const helperText = (() => {
    if (!isPushSupported()) {
      return "On iPhone, add OCS to your Home Screen, then open the app to enable alerts.";
    }

    if (!available) {
      return "Push alerts are not configured on this server yet.";
    }

    if (permission === "denied") {
      return "Notifications are blocked. Enable them in your device Settings for OCS.";
    }

    if (role === "doctor") {
      return "Get mobile alerts when your kit items fall below 50% par level.";
    }

    if (role === "admin" || role === "operator") {
      return "Get alerts when OCS stock items are at or below par level (reminder every 6 hours).";
    }

    return "Low stock and HCM management updates";
  })();

  const toggleDisabled = isUpdating || !available;

  async function handleToggle() {
    if (isUpdating || !available) {
      return;
    }

    if (permission === "denied") {
      setShowDeniedGuide(true);
      return;
    }

    setIsUpdating(true);

    try {
      if (enabled) {
        await unsubscribeFromPushNotifications();
        setEnabled(false);
        toast.success("Push notifications turned off.");
      } else {
        await subscribeToPushNotifications();
        setEnabled(true);
        toast.success("Push notifications turned on.");
      }
    } catch (error) {
      if (error instanceof PushPermissionDeniedError) {
        setShowDeniedGuide(true);
      } else {
        toast.error(error.message || "Could not update push notification settings.");
      }
      await refreshState();
    } finally {
      setIsUpdating(false);
    }
  }

  async function handleRetryAfterSettings() {
    setShowDeniedGuide(false);
    setIsUpdating(true);

    try {
      await subscribeToPushNotifications();
      setEnabled(true);
      setPermission("granted");
      toast.success("Push notifications turned on.");
    } catch (error) {
      if (error instanceof PushPermissionDeniedError) {
        setShowDeniedGuide(true);
      } else {
        toast.error(error.message || "Could not update push notification settings.");
      }
      await refreshState();
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <>
      <ToggleShell
        className={className}
        onDark={onDark}
        helperText={helperText}
        permission={permission}
        onShowDeniedGuide={() => setShowDeniedGuide(true)}
      >
        <label
          className={`relative inline-flex shrink-0 items-center ${toggleDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
        >
          <input
            type="checkbox"
            className="peer sr-only"
            checked={enabled}
            disabled={toggleDisabled}
            onChange={handleToggle}
            aria-label="Toggle push notifications"
          />
          <div
            className="peer relative h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:size-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-teal-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-teal-500"
            aria-hidden
          />
        </label>
      </ToggleShell>

      {showDeniedGuide ? (
        <DeniedGuideModal
          recovery={recovery}
          onClose={() => setShowDeniedGuide(false)}
          onRetry={handleRetryAfterSettings}
        />
      ) : null}
    </>
  );
}

function ToggleShell({ className, onDark, helperText, permission, onShowDeniedGuide, children }) {
  return (
    <div
      className={[
        "mx-5 mt-6 flex items-center justify-between border-t px-2 pt-4",
        onDark ? "border-white/10" : "border-gray-100",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex flex-col pr-3">
        <span
          className={onDark ? "text-xs font-bold tracking-wide text-white" : "text-xs font-bold tracking-wide text-gray-700"}
        >
          Push Notifications
        </span>
        <span
          className={
            onDark
              ? "mt-0.5 text-[10px] leading-snug text-[#d1dede]"
              : "mt-0.5 text-[10px] leading-snug text-gray-400"
          }
        >
          {helperText}
        </span>
        {permission === "denied" ? (
          <button
            type="button"
            onClick={onShowDeniedGuide}
            className={
              onDark
                ? "mt-1 text-left text-[10px] font-semibold text-amber-200 underline-offset-2 hover:underline"
                : "mt-1 text-left text-[10px] font-semibold text-amber-700 underline-offset-2 hover:underline"
            }
          >
            How to re-enable alerts
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function DeniedGuideModal({ recovery, onClose, onRetry }) {
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 p-4 sm:items-center">
      <div
        className="w-full max-w-md rounded-2xl border border-amber-200 bg-[#fff8eb] p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="Notification permission recovery"
      >
        <p className="text-base font-semibold text-[#7a4b00]">{recovery.title}</p>
        <p className="mt-2 text-sm leading-relaxed text-[#8a5a12]">{recovery.description}</p>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-[#7a4b00]">
          {recovery.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center justify-center rounded-xl bg-[#2d8f98] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#257a82]"
          >
            I updated settings
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-semibold text-[#7a4b00] transition hover:bg-amber-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default PushNotificationToggle;
