import { api } from "./api.js";

const SW_PATH = "/sw.js";
const PUSH_DISMISS_KEY = "ocs_push_banner_dismissed";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isPushBannerDismissed() {
  return window.localStorage.getItem(PUSH_DISMISS_KEY) === "1";
}

export function dismissPushBanner() {
  window.localStorage.setItem(PUSH_DISMISS_KEY, "1");
}

export async function fetchPushConfiguration() {
  if (!isPushSupported()) {
    return { configured: false, publicKey: null };
  }

  try {
    const payload = await api.get("/push/vapid-public-key");
    const publicKey = payload?.publicKey || null;

    return {
      configured: Boolean(payload?.configured && publicKey),
      publicKey,
    };
  } catch {
    return { configured: false, publicKey: null };
  }
}

export async function getPushServiceWorkerRegistration() {
  if (!isPushSupported()) {
    return null;
  }

  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) {
    return existing;
  }

  await navigator.serviceWorker.register(SW_PATH);
  return navigator.serviceWorker.ready;
}

export async function registerServiceWorker() {
  return getPushServiceWorkerRegistration();
}

export async function getPushPermissionState() {
  if (!isPushSupported()) {
    return "unsupported";
  }

  return Notification.permission;
}

export function getPushBannerCopy(role) {
  if (role === "doctor") {
    return {
      title: "Enable alerts",
      description:
        "Get low stock and HCM updates on this device, even when OCS is in the background.",
    };
  }

  if (role === "admin" || role === "operator") {
    return {
      title: "Enable alerts",
      description:
        "Get low stock reminders for OCS inventory on this device, with alerts every 6 hours until items are restocked.",
    };
  }

  return {
    title: "Enable alerts",
    description:
      "Get HCM news and operational updates on this device, even when OCS is in the background.",
  };
}

export async function isPushNotificationsEnabled() {
  if (!isPushSupported()) {
    return false;
  }

  if (Notification.permission !== "granted") {
    return false;
  }

  const { configured } = await fetchPushConfiguration();
  if (!configured) {
    return false;
  }

  try {
    const registration = await getPushServiceWorkerRegistration();
    return Boolean(await registration?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export async function syncPushSubscriptionIfGranted() {
  if (!isPushSupported()) {
    return null;
  }

  if (Notification.permission !== "granted") {
    return null;
  }

  const { configured, publicKey } = await fetchPushConfiguration();
  if (!configured || !publicKey) {
    return null;
  }

  try {
    const registration = await getPushServiceWorkerRegistration();
    if (!registration) {
      return null;
    }

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));

    await api.post("/push/subscribe", { subscription: subscription.toJSON() });
    return subscription;
  } catch {
    return null;
  }
}

export async function subscribeToPushNotifications() {
  if (!isPushSupported()) {
    throw new Error("Push notifications are not supported on this device.");
  }

  const { configured, publicKey } = await fetchPushConfiguration();
  if (!configured || !publicKey) {
    throw new Error("Push notifications are not available on this server yet.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const registration = await getPushServiceWorkerRegistration();
  if (!registration) {
    throw new Error("Could not register the notification service on this device.");
  }

  const existing = await registration.pushManager.getSubscription();

  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  await api.post("/push/subscribe", { subscription: subscription.toJSON() });
  window.localStorage.removeItem(PUSH_DISMISS_KEY);

  return subscription;
}

export async function unsubscribeFromPushNotifications() {
  if (!isPushSupported()) {
    return;
  }

  const registration = await getPushServiceWorkerRegistration();
  const subscription = await registration?.pushManager.getSubscription();

  if (subscription) {
    await subscription.unsubscribe();
  }

  try {
    await api.delete("/push/subscribe");
  } catch {
    // Best-effort cleanup when server session is unavailable.
  }
}
