// Service worker: appið og vistuð kort virka án sambands.
const SHELL_CACHE = "smali-shell-v4";
const TILE_CACHE = "smali-tiles-v1";
const SHELL = [
  "/",
  "/app.js",
  "/sweep.js",
  "/cover.js",
  "/style.css",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/vendor/leaflet/leaflet.js",
  "/vendor/leaflet/leaflet.css",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("smali-shell-") && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // alltaf beint á netið

  if (url.pathname.startsWith("/tile/")) {
    e.respondWith(tile(req));
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith(shell("/", e));
    return;
  }
  e.respondWith(shell(url.pathname, e));
});

// Kort: úr minni ef til, annars af netinu og vistað
async function tile(req) {
  const c = await caches.open(TILE_CACHE);
  const key = new URL(req.url).pathname;
  const hit = await c.match(key);
  if (hit) return hit;
  try {
    const r = await fetch(req);
    if (r.ok) c.put(key, r.clone());
    return r;
  } catch {
    return new Response("", { status: 504 });
  }
}

// Appið sjálft: svara strax úr minni (virkar í engu sambandi) og uppfæra í bakgrunni
async function shell(path, e) {
  const c = await caches.open(SHELL_CACHE);
  const hit = await c.match(path);
  const update = fetch(path, { cache: "no-cache" })
    .then((r) => {
      if (r.ok && !r.redirected) c.put(path, r.clone());
      return r;
    })
    .catch(() => null);
  if (hit) {
    e.waitUntil(update);
    return hit;
  }
  const r = await update;
  return r || new Response("Ekkert samband og appið er ekki vistað ennþá.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
}
