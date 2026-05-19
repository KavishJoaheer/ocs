self.addEventListener("push", (event) => {
  let data = {
    title: "OCS Update",
    body: "You have a new notification.",
    url: "/",
    icon: "/favicon.svg",
  };

  try {
    data = event.data?.json() || data;
  } catch {
    // Keep default payload when push body is not JSON.
  }

  const targetUrl = data.url || "/";
  const tag = data.tag || "ocs-alert";

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || "/favicon.svg",
      badge: "/favicon.svg",
      tag,
      renotify: true,
      data: { url: targetUrl },
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
