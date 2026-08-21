/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { localise } from "./push-text";

declare let self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//, /^\/openapi\.json/, /^\/docs/],
  }),
);

// posters: cache-first (both the backend proxy and direct TMDB urls)
registerRoute(
  ({ url }) => url.pathname === "/api/v1/poster" || url.hostname === "image.tmdb.org",
  new CacheFirst({
    cacheName: "posters",
    plugins: [new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 14 * 86400 })],
  }),
);

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  const text = localise(data);
  // A tag makes the OS replace the banner it already shows for that group
  // instead of stacking a new one — the server reuses it per series/event.
  const options: NotificationOptions & { renotify?: boolean } = {
    body: text.body,
    icon: "/pwa-192.png",
    badge: "/pwa-192.png",
    data: { url: typeof data.url === "string" ? data.url : "/" },
  };
  if (typeof data.tag === "string" && data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(text.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url: string = event.notification.data?.url ?? "/";
  event.waitUntil(
    (async () => {
      const windows = (await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })) as readonly WindowClient[];
      // reuse the running app when there is one: on iOS a second window would
      // cold-start the PWA and lose wherever the user was
      const open = windows.find((client) => "focus" in client);
      if (open) {
        await open.focus();
        await open.navigate(url).catch(() => {});
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
