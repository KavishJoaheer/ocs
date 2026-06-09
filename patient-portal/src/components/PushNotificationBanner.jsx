import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import toast from "react-hot-toast";
import {
  PushPermissionDeniedError,
  dismissPushBanner,
  fetchPushConfiguration,
  getPushPermissionState,
  isPushBannerDismissed,
  isPushSupported,
  subscribeToPushNotifications,
} from "../lib/pushNotifications.js";

function PushNotificationBanner({ className = "" }) {
  const [visible, setVisible] = useState(false);
  const [isDenied, setIsDenied] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);

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
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) {
    return null;
  }

  async function handleEnable() {
    setIsEnabling(true);
    try {
      await subscribeToPushNotifications();
      toast.success("Visit alerts enabled.");
      setVisible(false);
      setIsDenied(false);
    } catch (error) {
      if (error instanceof PushPermissionDeniedError) {
        setIsDenied(true);
      } else {
        toast.error(error?.message || "Could not enable notifications.");
      }
    } finally {
      setIsEnabling(false);
    }
  }

  return (
    <div
      className={[
        "flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-[rgba(65,200,198,0.22)]",
        "bg-[linear-gradient(135deg,rgba(65,200,198,0.12),rgba(255,255,255,0.95))] p-4",
        className,
      ].join(" ")}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#065a60]/10 text-[#065a60]">
          <BellRing className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#22485b]">Get visit alerts on this device</p>
          <p className="mt-1 text-xs leading-relaxed text-[#5b7f8a]">
            {isDenied
              ? "Notifications are blocked. Enable them in your device settings to get doctor-assigned and en-route alerts."
              : "Know instantly when a doctor is assigned, on the way, or has arrived."}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!isDenied ? (
          <button
            type="button"
            onClick={handleEnable}
            disabled={isEnabling}
            className="rounded-full bg-[#065a60] px-4 py-2 text-xs font-bold text-white transition hover:brightness-105 disabled:opacity-60"
          >
            {isEnabling ? "Enabling…" : "Enable alerts"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            dismissPushBanner();
            setVisible(false);
          }}
          className="rounded-full p-2 text-[#94a9ad] transition hover:bg-white/80 hover:text-[#5b7f8a]"
          aria-label="Dismiss notification banner"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

export default PushNotificationBanner;
