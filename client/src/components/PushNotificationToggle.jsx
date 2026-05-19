import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  fetchPushConfiguration,
  getPushPermissionState,
  isPushNotificationsEnabled,
  isPushSupported,
  subscribeToPushNotifications,
  unsubscribeFromPushNotifications,
} from "../lib/pushNotifications.js";

function PushNotificationToggle({ className = "", alwaysShow = false, role = null }) {
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(false);
  const [permission, setPermission] = useState("unsupported");
  const [isUpdating, setIsUpdating] = useState(false);

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

  const toggleDisabled = isUpdating || !available || permission === "denied";

  async function handleToggle() {
    if (toggleDisabled) {
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
      toast.error(error.message || "Could not update push notification settings.");
      await refreshState();
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <div
      className={`mx-5 mt-6 flex items-center justify-between border-t border-gray-100 px-2 pt-4 ${className}`.trim()}
    >
      <div className="flex flex-col pr-3">
        <span className="text-xs font-bold tracking-wide text-gray-700">Push Notifications</span>
        <span className="mt-0.5 text-[10px] leading-snug text-gray-400">{helperText}</span>
      </div>
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
    </div>
  );
}

export default PushNotificationToggle;
