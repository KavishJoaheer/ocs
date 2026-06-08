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
  isPushSupported,
  subscribeToPushNotifications,
} from "../lib/pushNotifications.js";

function PushNotificationBanner({ role, className = "" }) {
  const [visible, setVisible] = useState(false);
  const [isDenied, setIsDenied] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);
  const copy = getPushBannerCopy(role);
  const recovery = getPushPermissionRecoveryInstructions();

  useEffect(() => {
    let cancelled = false;

    async function evaluateVisibility() {
      if (!isPushSupported() || isPushBannerDismissed()) {
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
        setIsDenied(permission === "denied");
        setVisible(configured && (permission === "default" || permission === "denied"));
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
    dismissPushBanner();
    setVisible(false);
  }

  const shellClassName = isDenied
    ? `rounded-2xl border border-amber-200 bg-[#fff8eb] px-4 py-3 shadow-sm ${className}`.trim()
    : `rounded-2xl border border-[#e6ebd9] bg-[#f4f6f0] px-4 py-3 shadow-sm ${className}`.trim();

  return (
    <div
      className={shellClassName}
      role="dialog"
      aria-modal="true"
      aria-label={isDenied ? "Notification permission recovery" : "Enable push notifications"}
    >
      <div className="flex items-start gap-3">
        <BannerIcon isDenied={isDenied} />

        <div className="min-w-0 flex-1">
          {isDenied ? (
            <>
              <p className="text-sm font-semibold text-[#7a4b00]">{recovery.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-[#8a5a12]">{recovery.description}</p>
              <ol className="mt-3 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-[#7a4b00]">
                {recovery.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-[#3b4733]">{copy.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-[#67755d]">{copy.description}</p>
            </>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
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
