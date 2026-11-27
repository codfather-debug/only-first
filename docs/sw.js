/* Only First service worker: the app shell works offline; scores always come fresh. */
const SHELL = "of-shell-v14";
const IMAGES = "of-img-v1";
const SHELL_FILES = ["./", "index.html", "style.css", "app.js", "maps.js", "i18n.js", "brand.js", "share.js", "teams.json",
  "config.json", "manifest.webmanifest", "icon.svg", "icons/icon-192.png", "logo.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => ![SHELL, IMAGES].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(cache, max) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Score data: network only (the page handles failures).
  if (url.pathname.endsWith("firsts.json")) return;
  // Logos and headshots: cache first, keep the newest 400.
  if (req.destination === "image" && url.origin !== location.origin) {
    e.respondWith(caches.open(IMAGES).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      c.put(req, res.clone()).then(() => trim(c, 400));
      return res;
    }));
    return;
  }
  // App shell: serve cached, refresh in the background.
  if (url.origin === location.origin) {
    e.respondWith(caches.open(SHELL).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
