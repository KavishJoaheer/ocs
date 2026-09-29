import { useEffect, useState } from "react";
import { BellRing, CheckCircle2, Settings } from "lucide-react";
import toast from "react-hot-toast";
import {
  PushPermissionDeniedError,
  fetchPushConfiguration,
  getPushPermissionState,
  isPushSupported,
  subscribeToPushNotifications,
} from "../../lib/pushNotifications.js";
import ProfileListCard from "./ProfileListCard.jsx";

function ProfileNotificationSettings() {
  const [status, setStatus] = useState("loading");
  const [configured, setConfigured] = useState(false);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      if (!isPushSupported()) {
        if (!cancelled) setStatus("unsupported");
        return;
      }

      const [{ configured: isConfigured }, permission] = await Promise.all([
        fetchPushConfiguration(),
        getPushPermissionState(),
      ]);
      if (!cancelled) {
        setConfigured(isConfigured);
        setStatus(permission);
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleEnable() {
    setEnabling(true);
    try {
      await subscribeToPushNotifications();
      setStatus("granted");
      toast.success("Care updates enabled.");
    } catch (error) {
      if (error instanceof PushPermissionDeniedError) {
        setStatus("denied");
      } else {
        toast.error(error?.message || "Could not enable notifications.");
      }
    } finally {
      setEnabling(false);
    }
  }

  const isGranted = status === "granted";
  const isDenied = status === "denied";
  const canEnable = configured && status === "default";

  return (
    <ProfileListCard
      title="Notifications"
      action={canEnable ? (
        <button type="button" onClick={handleEnable} disabled={enabling} className="inline-flex min-h-9 items-center rounded-full bg-[#2d8f98] px-3 text-[12px] font-semibold text-white disabled:opacity-50">
          {enabling ? "Enabling…" : "Enable"}
        </button>
      ) : null}
    >
      <div className="flex items-start gap-3 px-5 pb-5 pt-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(26,160,140,0.08)] text-[#2d8f98]">
          {isGranted ? <CheckCircle2 className="size-5" /> : isDenied ? <Settings className="size-5" /> : <BellRing className="size-5" />}
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-[#1a5c52]">
            {isGranted ? "Care alerts are enabled" : isDenied ? "Alerts are blocked in device settings" : status === "unsupported" ? "Alerts are not supported on this device" : configured ? "Care alerts are off" : "Care alerts are unavailable"}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-[#6e8587]">
            {isDenied
              ? "Open your browser or device settings to allow notifications for OCS Care."
              : isGranted
                ? "You can receive visit updates and new Care Stories on this device."
                : "Enable notifications to receive visit updates and new Care Stories."}
          </p>
        </div>
      </div>
    </ProfileListCard>
  );
}

export default ProfileNotificationSettings;
