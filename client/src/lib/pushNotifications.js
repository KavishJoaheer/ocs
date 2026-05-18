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

export async function registerServiceWorker() {
  if (!isPushSupported()) {
    return null;
  }

  return navigator.serviceWorker.register(SW_PATH);
}

export async function getPushPermissionState() {
  if (!isPushSupported()) {
    return "unsupported";
  }

  return Notification.permission;
}

export async function subscribeToPushNotifications() {
  if (!isPushSupported()) {
    throw new Error("Push notifications are not supported on this device.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const { publicKey } = await api.get("/push/vapid-public-key");
  if (!publicKey) {
    throw new Error("Push notifications are not configured on the server.");
  }

  const registration = await registerServiceWorker();
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

  const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
  const subscription = await registration?.pushManager.getSubscription();

  if (subscription) {
    await subscription.unsubscribe();
  }

  await api.delete("/push/subscribe");
}
