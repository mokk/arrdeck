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
  event.waitUntil(
    self.registration.showNotification(data.title ?? "arrdeck", {
      body: data.body ?? "",
      icon: "/pwa-192.png",
      badge: "/pwa-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/"));
});
