import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import toast from "react-hot-toast";
import {
  dismissPushBanner,
  fetchPushConfiguration,
  getPushBannerCopy,
  getPushPermissionState,
  isPushBannerDismissed,
  isPushSupported,
  subscribeToPushNotifications,
} from "../lib/pushNotifications.js";

function PushNotificationBanner({ role, className = "" }) {
  const [visible, setVisible] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);
  const copy = getPushBannerCopy(role);

  useEffect(() => {
    let cancelled = false;

    async function evaluateVisibility() {
      if (!isPushSupported() || isPushBannerDismissed()) {
        if (!cancelled) {
          setVisible(false);
        }
        return;
      }

      const [{ configured }, permission] = await Promise.all([
        fetchPushConfiguration(),
        getPushPermissionState(),
      ]);

      if (!cancelled) {
        setVisible(configured && permission === "default");
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
      toast.success("Notifications enabled.");
      setVisible(false);
    } catch (error) {
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

  return (
    <div
      className={`rounded-2xl border border-[#e6ebd9] bg-[#f4f6f0] px-4 py-3 shadow-sm ${className}`.trim()}
      role="region"
      aria-label="Enable push notifications"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#2d8f98] shadow-sm">
          <BellRing className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#3b4733]">{copy.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-[#67755d]">{copy.description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isEnabling}
              onClick={handleEnable}
              className="inline-flex items-center justify-center rounded-xl bg-[#2d8f98] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#257a82] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isEnabling ? "Enabling..." : "Turn on notifications"}
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

export default PushNotificationBanner;
