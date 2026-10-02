// Service Worker: hält die App und die Kartenbilder offline bereit.
// Daten von GitHub und Anfragen an Gemini laufen nie über den Zwischenspeicher.
const VERSION = "v15";
const APP = ["./", "index.html", "app.js", "erkennung.js", "speicher.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "daten/karten-index.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open("app-" + VERSION).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(namen => Promise.all(namen.filter(n => n.startsWith("app-") && n !== "app-" + VERSION).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.hostname === "assets.tcgdex.net" || url.hostname.endsWith("gstatic.com") || url.hostname === "fonts.googleapis.com") {
    // Kartenbilder und Schriften: einmal geladen, dann aus dem Zwischenspeicher
    e.respondWith(caches.open("bilder").then(async c => {
      const alt = await c.match(e.request);
      if (alt) return alt;
      const neu = await fetch(e.request);
      if (neu.ok) c.put(e.request, neu.clone());
      return neu;
    }));
    return;
  }
  if (url.origin === self.location.origin) {
    // App-Dateien: zuerst aus dem Netz (damit Updates ankommen), ohne Netz aus dem Zwischenspeicher
    e.respondWith(fetch(e.request).then(antwort => {
      if (antwort.ok) caches.open("app-" + VERSION).then(c => c.put(e.request, antwort.clone()));
      return antwort;
    }).catch(() => caches.match(e.request).then(a => a || caches.match("index.html"))));
  }
});
