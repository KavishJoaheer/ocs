import { api } from "./api.js";

const SW_PATH = "/sw.js";
const PUSH_DISMISS_KEY = "ocs_push_banner_dismissed";
const PUSH_SUBSCRIBER_ROLES = ["admin", "doctor", "operator", "lab_tech", "accountant"];

export class PushPermissionDeniedError extends Error {
  constructor() {
    super("Notifications are blocked in your browser settings.");
    this.name = "PushPermissionDeniedError";
    this.recoveryInstructions = getPushPermissionRecoveryInstructions();
  }
}

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

export function listenForPushSubscriptionChanges(onChange) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return () => {};
  }

  function handleMessage(event) {
    if (event?.data?.type === "ocs:push-subscription-change") {
      onChange?.();
    }
  }

  navigator.serviceWorker.addEventListener("message", handleMessage);
  return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
}

export async function getPushPermissionState() {
  if (!isPushSupported()) {
    return "unsupported";
  }

  return Notification.permission;
}

export function getPushPermissionRecoveryInstructions() {
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isIOS =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (typeof navigator !== "undefined" &&
      navigator.platform === "MacIntel" &&
      navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(userAgent);

  if (isIOS) {
    return {
      title: "Notifications blocked",
      description:
        "Low-stock and HCM alerts cannot reach this device until iOS notifications are re-enabled for OCS.",
      steps: [
        "Open Settings → Notifications",
        "Select the OCS home-screen app",
        "Turn on Allow Notifications and Alerts",
        "Return here and enable alerts again",
      ],
    };
  }

  if (isAndroid) {
    return {
      title: "Notifications blocked",
      description:
        "Critical inventory alerts are paused because Android blocked notifications for this app or browser.",
      steps: [
        "Open Settings → Apps → OCS (or Chrome if using the browser)",
        "Tap Notifications and enable all categories",
        "Return here and turn alerts back on",
      ],
    };
  }

  return {
    title: "Notifications blocked",
    description: "Your browser is blocking OCS alerts. Re-enable notifications in site settings to restore them.",
    steps: [
      "Open browser settings for this site",
      "Set Notifications to Allow",
      "Reload OCS and enable alerts again",
    ],
  };
}

export function canSubscribeToPush(role) {
  return PUSH_SUBSCRIBER_ROLES.includes(role);
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

export async function refreshPushSubscriptionOnLogin(role) {
  if (!canSubscribeToPush(role)) {
    return null;
  }

  return syncPushSubscriptionIfGranted();
}

export async function subscribeToPushNotifications() {
  if (!isPushSupported()) {
    throw new Error("Push notifications are not supported on this device.");
  }

  if (Notification.permission === "denied") {
    throw new PushPermissionDeniedError();
  }

  const { configured, publicKey } = await fetchPushConfiguration();
  if (!configured || !publicKey) {
    throw new Error("Push notifications are not available on this server yet.");
  }

  const permission = await Notification.requestPermission();
  if (permission === "denied") {
    throw new PushPermissionDeniedError();
  }

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

  try {
    await api.post("/push/subscribe", { subscription: subscription.toJSON() });
  } catch (error) {
    throw new Error(error?.message || "Could not save your notification subscription on the server.");
  }

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
