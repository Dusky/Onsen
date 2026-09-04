/**
 * The app shell's service worker (SPEC §16).
 *
 * "Web manifest plus a service worker caching the app shell only. No offline
 * chat sync." — so this caches the build's own files and nothing else. `/api`
 * is never touched: a cached scene would be a lie the moment the phone and the
 * desktop disagreed, a cached session cookie response would be a security
 * problem, and a cached SSE stream would be neither.
 *
 * Generated from `client/sw-template.js` by the Vite plugin in
 * `vite.config.ts`, which substitutes the build's hashed filenames. Do not edit
 * `dist/client/sw.js`.
 */
const VERSION = "__VERSION__";
const CACHE = `onsen-shell-${VERSION}`;
const SHELL = __PRECACHE__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Individually rather than addAll, so one missing file does not throw the
      // whole install away and leave the app with no worker at all.
      await Promise.all(
        SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {})),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("onsen-shell-") && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

/** Files the build emitted, which are content-hashed or version-stamped. */
function isShellAsset(pathname) {
  return (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/fonts/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/manifest.webmanifest"
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Everything the server owns goes to the server, every time.
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return;

  if (isShellAsset(url.pathname)) {
    // Cache first: these filenames change when their contents do.
    event.respondWith(
      (async () => {
        const hit = await caches.match(request);
        if (hit !== undefined) return hit;
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
        return response;
      })(),
    );
    return;
  }

  if (request.mode === "navigate") {
    // Network first, because a deep link is answered by the server's history
    // fallback and the shell is only the offline consolation prize.
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const shell = await caches.match("/index.html");
          if (shell !== undefined) return shell;
          throw new Error("offline");
        }
      })(),
    );
  }
});
