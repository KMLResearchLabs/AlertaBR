self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/images/icon.png",
      badge: "/images/icon.png",
      data: {
        url: payload.url || "/#home",
        alertId: payload.alertId || null
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const rawUrl = event.notification && event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : self.location.origin + "/#home";
  const targetUrl = new URL(rawUrl, self.location.origin).toString();

  event.waitUntil(
    self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((clients) => {
      const matchingClient = clients.find((client) => client.url.startsWith(self.location.origin));

      if (matchingClient) {
        return matchingClient.focus().then(() => matchingClient.navigate(targetUrl));
      }

      return self.clients.openWindow(targetUrl);
    })
  );
});

function parsePushPayload(event) {
  if (!event.data) {
    return {
      title: "AlertaBR",
      body: "Novo alerta disponível.",
      tag: "alertabr-push",
      url: "/#home"
    };
  }

  try {
    const payload = event.data.json();
    return {
      title: payload.title || "AlertaBR",
      body: payload.body || "Novo alerta disponível.",
      tag: payload.tag || "alertabr-push",
      url: payload.url || "/#home",
      alertId: payload.alertId || null
    };
  } catch (_error) {
    return {
      title: "AlertaBR",
      body: event.data.text() || "Novo alerta disponível.",
      tag: "alertabr-push",
      url: "/#home"
    };
  }
}
