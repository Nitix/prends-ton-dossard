// The service worker of « Prends ton dossard ». It makes the site installable
// and keeps the app working for a short while without a network, and nothing
// more: the data (everything under /api/) is never kept.
//
// It is a classic script, not a module, which every browser accepts for a
// worker. It is written by hand and served as is (see public/ in Vite, and
// server/webdist/spa.go, which sends it with `Cache-Control: no-cache`).
//
// Old files of /assets/ stay in the cache of the current version: their names
// carry a fingerprint, so they are never wrong, only unused, and a few
// kilobytes each. Raising the number below throws every cache away at the next
// activation; changing this file is also what makes browsers install the new
// worker.

const CACHE = "ptd-1";

// The key of the page. The app is a single page, and every route of it is the
// same index.html: one copy serves them all.
const SHELL = "/";

// What the installation keeps.
const PRECACHE = [
  SHELL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

/**
 * How the worker answers a request of its own origin.
 * - "network-first": a page. The network, so that a deploy shows at once; the
 *   last page kept if the network fails.
 * - "cache-first": a built file. Its name changes with its content.
 * - "network-only": anything else. The worker does not answer, and the browser
 *   asks the network as it would without a worker.
 *
 * @param {URL} url
 * @param {string} mode the mode of the request: "navigate" for a page
 * @returns {"network-first" | "cache-first" | "network-only"}
 */
function strategyFor(url, mode) {
  const path = url.pathname;
  if (mode === "navigate") {
    // PocketBase's own pages (see `reserved` in server/webdist/spa.go): the
    // dashboard is HTML, and must never be kept as the shell of the app.
    return isPocketBasePath(path) ? "network-only" : "network-first";
  }
  if (path.startsWith("/assets/")) return "cache-first";
  return "network-only";
}

function isPocketBasePath(path) {
  return path === "/api" || path.startsWith("/api/") || path === "/_" || path.startsWith("/_/");
}

/** Only a complete answer of the site itself is worth keeping: no error, no redirect, no opaque response. */
function isKeepable(response) {
  return response.status === 200 && response.type === "basic" && !response.redirected;
}

/** What the current cache holds for `key`, or undefined. A storage that fails is a cache that is empty. */
async function recall(key) {
  try {
    const cache = await caches.open(CACHE);
    return await cache.match(key);
  } catch {
    return undefined;
  }
}

/**
 * Keeps a copy of `response` under `key`, if it is worth it. The copy is made
 * at once, before the first await, so that the caller can give the response to
 * the page right after. A full storage loses the copy, not the page.
 */
async function keep(key, response) {
  if (!isKeepable(response)) return;
  const copy = response.clone();
  try {
    const cache = await caches.open(CACHE);
    await cache.put(key, copy);
  } catch {
    // Nothing to do: the next visit asks the network again.
  }
}

async function networkFirst(event) {
  let response;
  try {
    response = await fetch(event.request);
  } catch (error) {
    const shell = await recall(SHELL);
    if (shell !== undefined) return shell;
    throw error;
  }
  event.waitUntil(keep(SHELL, response));
  return response;
}

async function cacheFirst(event) {
  const kept = await recall(event.request);
  if (kept !== undefined) return kept;
  const response = await fetch(event.request);
  event.waitUntil(keep(event.request, response));
  return response;
}

async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.all(
    PRECACHE.map(async (path) => {
      // "reload": the copy that the browser's own cache may hold could be of an older build.
      const response = await fetch(path, { cache: "reload" });
      if (!isKeepable(response)) throw new Error(`${path}: ${response.status}`);
      await cache.put(path, response);
    }),
  );
}

self.addEventListener("install", (event) => {
  // The new worker does not wait for the tabs of the old one to close.
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  switch (strategyFor(url, request.mode)) {
    case "network-first":
      event.respondWith(networkFirst(event));
      break;
    case "cache-first":
      event.respondWith(cacheFirst(event));
      break;
    default:
      // "network-only": no answer, so the browser goes to the network by itself.
      break;
  }
});
