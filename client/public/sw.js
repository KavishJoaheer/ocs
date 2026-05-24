const DEFAULT_ICON = "/icon-192.png";
const DEFAULT_BADGE = "/icon-192.png";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

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
  if (!event.data) {
    return;
  }

  let alertData = buildNotificationPayload();

  try {
    alertData = buildNotificationPayload(event.data.json());
  } catch {
    try {
      alertData = buildNotificationPayload({ body: event.data.text() });
    } catch {
      // Keep default payload when push body is unreadable.
    }
  }

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

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      windowClients.forEach((client) => {
        client.postMessage({ type: "ocs:push-subscription-change" });
      });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const relativeUrl = event.notification?.data?.url || "/";
  const targetUrl = new URL(relativeUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      const existing = windowClients.find((client) => client.url.includes(self.location.origin));

      if (existing) {
        existing.focus();
        if ("navigate" in existing) {
          return existing.navigate(targetUrl);
        }
        return undefined;
      }

      return clients.openWindow(targetUrl);
    }),
  );
});
