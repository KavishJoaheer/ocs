const DEFAULT_ICON = "/icon-192.png";
const DEFAULT_BADGE = "/icon-192.png";
const PUSH_CONFIG_CACHE = "ocs-push-config-v1";
const VAPID_KEY_REQUEST = "/__ocs_vapid_public_key__";
const PENDING_SUBSCRIPTION_REQUEST = "/__ocs_pending_push_subscription__";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
    // Cache API can be unavailable in private modes; nothing we can do here.
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
    title: raw.title || "OCS Update",
    body: raw.body || "You have a new notification.",
    url: raw.url || "/",
    icon: raw.icon || DEFAULT_ICON,
    badge: raw.badge || DEFAULT_BADGE,
    tag: raw.tag || "ocs-alert",
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
        // Keep default payload when push body is unreadable.
      }
    }
  }

  // Even when the gateway delivers a wake-only push with no data, surface a
  // generic notification rather than silently dropping it — otherwise the
  // browser may eventually revoke our push permission for not honouring
  // `userVisibleOnly: true`.

  const targetUrl = alertData.url || "/";

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

async function notifyClientsOfSubscriptionChange(subscriptionJson) {
  const windowClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  windowClients.forEach((client) => {
    client.postMessage({
      type: "ocs:push-subscription-change",
      subscription: subscriptionJson,
    });
  });

  return windowClients.length;
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      let nextSubscriptionJson = null;

      // Try to re-subscribe inside the SW itself using the cached VAPID key.
      // This is the recommended path because the browser may invalidate the
      // subscription while the PWA is closed (common on iOS); without an
      // in-SW recovery the user loses push until they manually toggle it.
      const publicKey = await cacheGetText(VAPID_KEY_REQUEST);
      if (publicKey) {
        try {
          const subscription = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
          nextSubscriptionJson = subscription.toJSON();
        } catch {
          // Re-subscribe can fail (no permission, gateway error). The page
          // path will retry next time the PWA opens.
        }
      }

      const clientCount = await notifyClientsOfSubscriptionChange(nextSubscriptionJson);

      if (nextSubscriptionJson && clientCount === 0) {
        // No window is alive to POST the new subscription to the server.
        // Stash it so the next page load can pick it up and sync.
        await cachePut(PENDING_SUBSCRIPTION_REQUEST, JSON.stringify(nextSubscriptionJson));
      } else if (nextSubscriptionJson) {
        await cacheDelete(PENDING_SUBSCRIPTION_REQUEST);
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
    return;
  }

  if (data.type === "ocs:clear-vapid-key") {
    event.waitUntil(
      Promise.all([cacheDelete(VAPID_KEY_REQUEST), cacheDelete(PENDING_SUBSCRIPTION_REQUEST)]),
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const relativeUrl = event.notification?.data?.url || "/";
  const targetUrl = new URL(relativeUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      const existing = windowClients.find((client) => client.url.includes(self.location.origin));

      if (existing) {
        const focusPromise = existing.focus();

        if ("navigate" in existing) {
          return Promise.resolve(focusPromise)
            .then(() => existing.navigate(targetUrl))
            .catch(() => {
              // Older Chromium WebViews disallow cross-origin navigate; fall
              // back to messaging the page so the SPA router can handle it.
              existing.postMessage({ type: "ocs:navigate", url: relativeUrl });
            });
        }

        existing.postMessage({ type: "ocs:navigate", url: relativeUrl });
        return undefined;
      }

      return clients.openWindow(targetUrl);
    }),
  );
});
