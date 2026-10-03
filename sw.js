// Service worker: offline app shell with a versioned cache.
// - Never swaps code silently: a new version waits until the page asks
//   (the user taps "Update ready").
// - Same-origin GET requests inside this app's scope only.
// - Only complete, same-origin 200 responses are ever cached.
// - Other apps on the same github.io origin are left alone: we only ever
//   delete caches whose names start with "stick-".

const VERSION = "0.7.0";
const PREFIX = "stick-";
const CACHE = PREFIX + VERSION;

const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest", "./css/app.css",
  "./js/main.js", "./js/schema.js", "./js/schedule.js", "./js/storage.js",
  "./js/ui.js", "./js/ics.js", "./js/reminders.js",
  "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-512-maskable.png",
];

const scope = () => self.registration.scope;
const INDEX = () => new URL("index.html", scope()).href;

self.addEventListener("install", e => {
  // cache: "reload" skips the HTTP cache so a new version gets fresh files.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: "reload" })))));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", e => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

const cacheable = res => res && res.ok && res.status === 200 && res.type === "basic";

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin || !req.url.startsWith(scope())) return;

  // Pages: always the cached shell of this version, so code never changes mid-use.
  if (req.mode === "navigate") {
    e.respondWith(
      caches.match(INDEX(), { cacheName: CACHE }).then(hit => hit || fetch(req)),
    );
    return;
  }

  // Everything else: cache first, then network (and keep good copies).
  e.respondWith(
    caches.match(req, { cacheName: CACHE }).then(hit => hit || fetch(req).then(res => {
      if (cacheable(res)) {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE).then(c => c.put(req, copy)));
      }
      return res;
    })),
  );
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ("focus" in c) return c.focus(); }
    return self.clients.openWindow("./");
  }));
});
