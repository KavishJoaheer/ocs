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

function PushNotificationToggle({ className = "" }) {
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const refreshState = useCallback(async () => {
    if (!isPushSupported()) {
      setAvailable(false);
      setEnabled(false);
      return;
    }

    const { configured } = await fetchPushConfiguration();
    if (!configured) {
      setAvailable(false);
      setEnabled(false);
      return;
    }

    setAvailable(true);
    const permission = await getPushPermissionState();
    if (permission !== "granted") {
      setEnabled(false);
      return;
    }

    setEnabled(await isPushNotificationsEnabled());
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  if (!available) {
    return null;
  }

  async function handleToggle() {
    if (isUpdating) {
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
      <div className="flex flex-col">
        <span className="text-xs font-bold tracking-wide text-gray-700">Push Notifications</span>
        <span className="text-[10px] text-gray-400">Low stock &amp; clinical alerts</span>
      </div>
      <label className="relative inline-flex cursor-pointer items-center">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={enabled}
          disabled={isUpdating}
          onChange={handleToggle}
          aria-label="Toggle push notifications"
        />
        <div
          className="peer relative h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:size-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-teal-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-teal-500 peer-disabled:opacity-60"
          aria-hidden
        />
      </label>
    </div>
  );
}

export default PushNotificationToggle;
