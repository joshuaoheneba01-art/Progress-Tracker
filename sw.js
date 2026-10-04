// Service worker: offline app shell with a versioned cache.
// - Never swaps code silently: a new version waits until the page asks
//   (the user taps "Update ready").
// - Same-origin GET requests inside this app's scope only.
// - Only complete, same-origin 200 responses are ever cached.
// - Other apps on the same github.io origin are left alone: we only ever
//   delete caches whose names start with "stick-".

const VERSION = "1.0.0";
const PREFIX = "stick-";
const CACHE = PREFIX + VERSION;

const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest", "./css/app.css",
  "./js/main.js", "./js/schema.js", "./js/schedule.js", "./js/storage.js",
  "./js/ui.js", "./js/ics.js", "./js/reminders.js", "./js/alarm.js",
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

// Alarm notifications carry data.key ("2026-10-05@blockId") and two actions.
// Snooze/Dismiss go to the open app; if the app is closed, Snooze opens it
// with #alarm=snooze:<key> so the snooze can be saved (the service worker
// cannot reach localStorage). Tapping the notification itself opens the app.
const ALARM_KEY_RE = /^\d{4}-\d{2}-\d{2}@[A-Za-z0-9_-]{1,40}$/;

self.addEventListener("notificationclick", e => {
  const n = e.notification;
  n.close();
  const key = n.data && typeof n.data.key === "string" && ALARM_KEY_RE.test(n.data.key) ? n.data.key : null;
  const action = e.action === "snooze" || e.action === "dismiss" ? e.action : "open";

  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    const c = cs.find(x => x.url.startsWith(scope()));
    if (key && action !== "open") {
      if (c) { c.postMessage({ type: "alarm", action, key }); return undefined; }
      return action === "snooze" ? self.clients.openWindow(`./#alarm=snooze:${key}`) : undefined;
    }
    if (c && "focus" in c) return c.focus();
    return self.clients.openWindow("./");
  }));
});
