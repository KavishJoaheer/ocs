import { api } from "./api.js";

const SW_PATH = "/sw.js";
const PUSH_DISMISS_KEY = "ocs_patient_push_banner_dismissed";

export class PushPermissionDeniedError extends Error {
  constructor() {
    super("Notifications are blocked in your browser settings.");
    this.name = "PushPermissionDeniedError";
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

async function postVapidKeyToServiceWorker(publicKey) {
  if (!publicKey || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const target = registration?.active || navigator.serviceWorker.controller;
    target?.postMessage({ type: "ocs:vapid-key", publicKey });
  } catch {
    // SW may not be ready yet; syncPushSubscriptionIfGranted retries.
  }
}

export async function fetchPushConfiguration() {
  if (!isPushSupported()) {
    return { configured: false, publicKey: null };
  }

  try {
    const payload = await api.get("/patient-portal/push/vapid-public-key");
    const publicKey = payload?.publicKey || null;
    const configured = Boolean(payload?.configured && publicKey);

    if (configured) {
      void postVapidKeyToServiceWorker(publicKey);
    }

    return { configured, publicKey };
  } catch {
    return { configured: false, publicKey: null };
  }
}

export async function getPushServiceWorkerRegistration() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  const registration = await navigator.serviceWorker.register(SW_PATH);
  try {
    await registration.update();
  } catch {
    // Offline or transient failure — keep using the current registration.
  }
  return registration;
}

export async function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  const registration = await navigator.serviceWorker.register(SW_PATH);
  try {
    await registration.update();
  } catch {
    // Offline or transient failure — keep using the current registration.
  }

  // Reload once when a waiting worker takes control so precached assets refresh.
  if (!window.__ocsSwReloadListener) {
    window.__ocsSwReloadListener = true;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  }

  if (registration?.waiting && navigator.serviceWorker.controller) {
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  }

  return registration;
}

export async function persistPushSubscriptionPayload(subscriptionJson) {
  if (!subscriptionJson?.endpoint) {
    return { ok: false, reason: "missing_endpoint" };
  }

  try {
    await api.post("/patient-portal/push/subscribe", { subscription: subscriptionJson });
    window.localStorage.removeItem(PUSH_DISMISS_KEY);
    return { ok: true };
  } catch (error) {
    console.warn("[push] could not persist subscription on server:", error?.message || error);
    return { ok: false, error };
  }
}

export async function getPushPermissionState() {
  if (!isPushSupported()) {
    return "unsupported";
  }

  return Notification.permission;
}

export async function isPushNotificationsEnabled() {
  if (!isPushSupported() || Notification.permission !== "granted") {
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
  if (!isPushSupported() || Notification.permission !== "granted") {
    return null;
  }

  const { configured, publicKey } = await fetchPushConfiguration();
  if (!configured || !publicKey) {
    return null;
  }

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

  const persisted = await persistPushSubscriptionPayload(subscription.toJSON());
  if (!persisted.ok) {
    return null;
  }

  return subscription;
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

  await api.post("/patient-portal/push/subscribe", { subscription: subscription.toJSON() });
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
    await api.delete("/patient-portal/push/subscribe");
  } catch {
    // Best-effort cleanup when server session is unavailable.
  }
}
