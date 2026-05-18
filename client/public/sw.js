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

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || "/favicon.svg",
      badge: "/favicon.svg",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || "/";

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
