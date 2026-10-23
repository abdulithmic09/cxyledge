// Cxyledge offline support.
// - The app itself (page, scripts, styles, icons) is kept so it opens without internet.
// - The book's data is fetched fresh every time; the last good copy is used only when the
//   network fails or is too slow, so you can still read the book in a yard with weak signal.
// - Saving changes always needs the internet; nothing is queued.
const VERSION = "cxyledge-v4";
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const DATA_TIMEOUT_MS = 6000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(["/"]))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("cxyledge-") && !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function networkFirst(request, cacheName, timeout, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await withTimeout(fetch(request), timeout);
    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch (error) {
    const hit = (await cache.match(request)) || (fallbackUrl ? await cache.match(fallbackUrl) : undefined);
    if (hit) return hit;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response && response.ok && response.type === "basic") cache.put(request, response.clone()).catch(() => undefined);
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: always try the network first, fall back to the saved app.
  if (request.mode === "navigate") {
    if (url.searchParams.has("install")) return;
    event.respondWith(networkFirst(request, SHELL, 8000, "/"));
    return;
  }

  // Built files have content hashes in their names, so a saved copy never goes stale.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/cx-icon-") || url.pathname === "/favicon.svg") {
    event.respondWith(cacheFirst(request));
    return;
  }

  // The book's data and the sign-in session: fresh when possible, last copy when offline.
  if (url.pathname.startsWith("/_serverFn/") || url.pathname === "/api/auth/get-session") {
    event.respondWith(networkFirst(request, DATA, DATA_TIMEOUT_MS));
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "cxyledge-clear") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("cxyledge-")).map((key) => caches.delete(key)))));
  }
});
