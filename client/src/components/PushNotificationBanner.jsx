import { useEffect, useState } from "react";
import { AlertTriangle, BellRing, X } from "lucide-react";
import toast from "react-hot-toast";
import {
  PushPermissionDeniedError,
  dismissPushBanner,
  fetchPushConfiguration,
  getPushBannerCopy,
  getPushPermissionRecoveryInstructions,
  getPushPermissionState,
  isPushBannerDismissed,
  isPushRecoverySeen,
  isPushSupported,
  markPushRecoverySeen,
  subscribeToPushNotifications,
} from "../lib/pushNotifications.js";

function PushNotificationBanner({ role, className = "" }) {
  const [visible, setVisible] = useState(false);
  const [isDenied, setIsDenied] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);
  const [showRecoveryHelp, setShowRecoveryHelp] = useState(false);
  const [compactRecovery, setCompactRecovery] = useState(false);
  const copy = getPushBannerCopy(role);
  const recovery = getPushPermissionRecoveryInstructions();

  useEffect(() => {
    let cancelled = false;

    async function evaluateVisibility() {
      if (!isPushSupported()) {
        if (!cancelled) {
          setVisible(false);
          setIsDenied(false);
        }
        return;
      }

      const [{ configured }, permission] = await Promise.all([
        fetchPushConfiguration(),
        getPushPermissionState(),
      ]);

      if (!cancelled) {
        const denied = permission === "denied";
        setIsDenied(denied);
        if (denied) {
          const recoverySeen = isPushRecoverySeen();
          setCompactRecovery(recoverySeen);
          if (!recoverySeen) markPushRecoverySeen();
        }
        setVisible(
          denied ||
            (configured && permission === "default" && !isPushBannerDismissed()),
        );
      }
    }

    evaluateVisibility();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        evaluateVisibility();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  if (!visible) {
    return null;
  }

  async function handleEnable() {
    setIsEnabling(true);

    try {
      await subscribeToPushNotifications();
      toast.success("Notifications enabled.");
      setVisible(false);
      setIsDenied(false);
    } catch (error) {
      if (error instanceof PushPermissionDeniedError) {
        setIsDenied(true);
        return;
      }

      const message = error?.message || "Could not enable notifications.";
      if (!message.toLowerCase().includes("not available")) {
        toast.error(message);
      }
      setVisible(false);
      dismissPushBanner();
    } finally {
      setIsEnabling(false);
    }
  }

  function handleDismiss() {
    if (isDenied) markPushRecoverySeen();
    dismissPushBanner();
    setVisible(false);
  }

  if (isDenied && compactRecovery) {
    return (
      <div className={`flex min-h-11 items-center gap-3 rounded-xl border border-amber-200 bg-[#fff8eb] px-3 py-2 ${className}`.trim()} role="status">
        <AlertTriangle className="size-4 shrink-0 text-amber-700" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-[#7a4b00]">
          Notifications blocked on this device.
        </p>
        <button
          type="button"
          onClick={() => setCompactRecovery(false)}
          className="min-h-9 shrink-0 rounded-lg border border-amber-200 bg-white px-3 text-xs font-semibold text-amber-800"
        >
          How to fix
        </button>
        <button type="button" onClick={handleDismiss} className="shrink-0 rounded-lg p-1 text-amber-700" aria-label="Dismiss notification notice">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  const shellClassName = isDenied
    ? `rounded-xl border border-amber-200 bg-[#fff8eb] px-3 py-2 shadow-sm sm:rounded-2xl sm:px-4 sm:py-3 ${className}`.trim()
    : `rounded-xl border border-[#e6ebd9] bg-[#f4f6f0] px-3 py-2 shadow-sm sm:rounded-2xl sm:px-4 sm:py-3 ${className}`.trim();

  return (
    <div
      className={shellClassName}
      role="dialog"
      aria-modal="true"
      aria-label={isDenied ? "Notification permission recovery" : "Enable push notifications"}
    >
      <div className="flex items-start gap-3">
        <div className="hidden sm:block"><BannerIcon isDenied={isDenied} /></div>

        <div className="min-w-0 flex-1">
          {isDenied ? (
            <>
              <p className="text-sm font-semibold text-[#7a4b00]">{recovery.title}</p>
              <p className={`${showRecoveryHelp ? "block" : "hidden"} mt-1 text-xs leading-relaxed text-[#8a5a12] sm:block`}>{recovery.description}</p>
              <ol className={`${showRecoveryHelp ? "block" : "hidden"} mt-3 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-[#7a4b00] sm:block`}>
                {recovery.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-[#3b4733]">{copy.title}</p>
              <p className="mt-1 hidden text-xs leading-relaxed text-[#67755d] sm:block">{copy.description}</p>
            </>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {isDenied ? (
              <button
                type="button"
                onClick={() => setShowRecoveryHelp((shown) => !shown)}
                className="inline-flex items-center justify-center rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-800 sm:hidden"
              >
                {showRecoveryHelp ? "Hide help" : "Show help"}
              </button>
            ) : null}
            <button
              type="button"
              disabled={isEnabling}
              onClick={handleEnable}
              className="inline-flex items-center justify-center rounded-xl bg-[#2d8f98] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#257a82] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isEnabling
                ? isDenied
                  ? "Checking..."
                  : "Enabling..."
                : isDenied
                  ? "I updated settings"
                  : "Turn on notifications"}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="inline-flex items-center justify-center rounded-xl border border-[#e6ebd9] bg-white px-3 py-2 text-xs font-semibold text-[#67755d] transition hover:bg-[#ebefe2]"
            >
              Not now
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          className="shrink-0 rounded-lg p-1 text-[#8fa382] transition hover:bg-[#ebefe2] hover:text-[#3b4733]"
          aria-label="Dismiss notification banner"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

function BannerIcon({ isDenied }) {
  return (
    <div
      className={`flex size-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ${
        isDenied ? "text-amber-700" : "text-[#2d8f98]"
      }`}
    >
      {isDenied ? <AlertTriangle className="size-5" aria-hidden /> : <BellRing className="size-5" aria-hidden />}
    </div>
  );
}

export default PushNotificationBanner;
