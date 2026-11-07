const CACHE_NAME = "nerloq-static-v2";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/nerloq-192.png",
  "/nerloq-512.png",
  "/nerloq-512-maskable.png"
];
const MAX_STATIC_ASSETS = 80;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL);
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("nerloq-static-") &&
                key !== CACHE_NAME
            )
            .map((key) => caches.delete(key))
        )
      )
    ])
  );
});

async function trimStaticCache(cache) {
  const keys = await cache.keys();
  const removable = keys.filter((request) => {
    const url = new URL(request.url);
    return !APP_SHELL.includes(url.pathname);
  });

  while ((await cache.keys()).length > MAX_STATIC_ASSETS) {
    const currentKeys = await cache.keys();
    const oldest = removable.find((request) =>
      currentKeys.some((key) => key.url === request.url)
    );

    if (!oldest) break;

    await cache.delete(oldest);
    removable.splice(removable.indexOf(oldest), 1);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/socket.io")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put("/index.html", response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cached =
            (await caches.match("/index.html")) ||
            (await caches.match("/"));
          if (cached) return cached;

          return new Response(
            "NERLOQ is offline. Reconnect to the internet and try again.",
            {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" }
            }
          );
        })
    );
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith("/assets/") ||
    /\.(?:png|jpg|jpeg|webp|svg|ico|woff2?)$/i.test(url.pathname);

  if (!isStaticAsset) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await fetch(request);

      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
        await trimStaticCache(cache);
      }

      return response;
    })
  );
});
