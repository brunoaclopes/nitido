// Nítido service worker: makes the app installable and usable offline.
// - The app's own files: network first (updates arrive at once), cache as the fallback.
// - Versioned libraries and models: cache first; they never change at the same URL.
// CLIP weights are cached by transformers.js itself and are not handled here.
const APP = "nitido-app-v2", LIBS = "nitido-libs-v1";
const SHELL = ["./", "index.html", "config.js", "styles/app.css", "fonts/instrument-sans-latin.woff2", "fonts/instrument-sans-latin-ext.woff2", "src/main.js", "manifest.webmanifest", "icon.svg"];
const LONG = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/@(mediapipe|huggingface)\/|storage\.googleapis\.com\/mediapipe-models\/)/;

self.addEventListener("install", (e) => { e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== APP && k !== LIBS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.includes("/api/")) return; // profiles on a self-hosted server: always live, never cached
    if (url.pathname.includes("/models/")) { e.respondWith(cacheFirst(req, LIBS)); return; }
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(APP).then((c) => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("index.html"))));
    return;
  }
  if (LONG.test(req.url)) e.respondWith(cacheFirst(req, LIBS));
});
async function cacheFirst(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(name).then((c) => c.put(req, copy)); }
  return res;
}
