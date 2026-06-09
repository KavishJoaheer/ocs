import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api/],
  }),
);

const DEFAULT_ICON = "/pwa-192.png";
const DEFAULT_BADGE = "/pwa-192.png";
const PUSH_CONFIG_CACHE = "ocs-patient-push-config-v1";
const VAPID_KEY_REQUEST = "/__ocs_patient_vapid_public_key__";
const PENDING_SUBSCRIPTION_REQUEST = "/__ocs_patient_pending_push_subscription__";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = self.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }
  return outputArray;
}

async function cachePut(key, value) {
  try {
    const cache = await caches.open(PUSH_CONFIG_CACHE);
    await cache.put(key, new Response(value));
  } catch {
    // ignore
  }
}

async function cacheGetText(key) {
  try {
    const cache = await caches.open(PUSH_CONFIG_CACHE);
    const response = await cache.match(key);
    if (!response) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function cacheDelete(key) {
  try {
    const cache = await caches.open(PUSH_CONFIG_CACHE);
    await cache.delete(key);
  } catch {
    // ignore
  }
}

function buildNotificationPayload(raw = {}) {
  return {
    title: raw.title || "OCS Patient Update",
    body: raw.body || "You have a new notification.",
    url: raw.url || "/dashboard",
    icon: raw.icon || DEFAULT_ICON,
    badge: raw.badge || DEFAULT_BADGE,
    tag: raw.tag || "ocs-patient-alert",
    requireInteraction: raw.requireInteraction !== false,
  };
}

self.addEventListener("push", (event) => {
  let alertData = buildNotificationPayload();

  if (event.data) {
    try {
      alertData = buildNotificationPayload(event.data.json());
    } catch {
      try {
        alertData = buildNotificationPayload({ body: event.data.text() });
      } catch {
        // Keep default payload.
      }
    }
  }

  const targetUrl = alertData.url || "/dashboard";

  event.waitUntil(
    self.registration.showNotification(alertData.title, {
      body: alertData.body,
      icon: alertData.icon,
      badge: alertData.badge,
      tag: alertData.tag,
      renotify: true,
      requireInteraction: alertData.requireInteraction,
      vibrate: [180, 90, 180],
      silent: false,
      data: {
        url: targetUrl,
        tag: alertData.tag,
      },
    }),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const publicKey = await cacheGetText(VAPID_KEY_REQUEST);
      if (!publicKey) return;

      try {
        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        const subscriptionJson = subscription.toJSON();
        const windowClients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });

        if (windowClients.length === 0) {
          await cachePut(PENDING_SUBSCRIPTION_REQUEST, JSON.stringify(subscriptionJson));
          return;
        }

        windowClients.forEach((client) => {
          client.postMessage({
            type: "ocs:push-subscription-change",
            subscription: subscriptionJson,
          });
        });
      } catch {
        // Page retries on next open.
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "ocs:vapid-key" && data.publicKey) {
    event.waitUntil(cachePut(VAPID_KEY_REQUEST, String(data.publicKey)));
    return;
  }

  if (data.type === "ocs:request-pending-subscription") {
    event.waitUntil(
      (async () => {
        const pending = await cacheGetText(PENDING_SUBSCRIPTION_REQUEST);
        if (!pending) return;
        let subscription = null;
        try {
          subscription = JSON.parse(pending);
        } catch {
          await cacheDelete(PENDING_SUBSCRIPTION_REQUEST);
          return;
        }
        const targets =
          event.source && typeof event.source.postMessage === "function"
            ? [event.source]
            : await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        targets.forEach((client) => {
          client.postMessage({ type: "ocs:push-subscription-change", subscription });
        });
        await cacheDelete(PENDING_SUBSCRIPTION_REQUEST);
      })(),
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const relativeUrl = event.notification?.data?.url || "/dashboard";
  const targetUrl = new URL(relativeUrl, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      const existing = windowClients.find((client) => client.url.includes(self.location.origin));

      if (existing) {
        const focusPromise = existing.focus();
        if ("navigate" in existing) {
          return Promise.resolve(focusPromise)
            .then(() => existing.navigate(targetUrl))
            .catch(() => {
              existing.postMessage({ type: "ocs:navigate", url: relativeUrl });
            });
        }
        existing.postMessage({ type: "ocs:navigate", url: relativeUrl });
        return undefined;
      }

      return self.clients.openWindow(targetUrl);
    }),
  );
});
