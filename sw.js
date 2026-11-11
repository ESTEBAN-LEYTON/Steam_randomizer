// Service worker: permite instalar la app y usarla sin conexión.
// - Archivos de la página y datos: primero la red (siempre lo último); si no hay conexión, la copia guardada.
// - Portadas de Steam: primero la copia guardada (no cambian y así carga más rápido).

const APP_CACHE = "backlog-app-v1";
const IMG_CACHE = "backlog-img-v1";
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "data.json",
  "config.json",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![APP_CACHE, IMG_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  } else if (url.hostname.endsWith("steamstatic.com") && url.pathname.startsWith("/store_item_assets/")) {
    event.respondWith(cachedImage(url.href));
  }
  // El resto (iconos antiguos de Steam, etc.) va directo a la red.
});

async function networkFirst(req) {
  const cache = await caches.open(APP_CACHE);
  const key = req.url.split("?")[0]; // una sola copia por archivo
  let res;
  try {
    // Se pide por URL: una petición de navegación no se puede reenviar con opciones.
    res = await fetch(key, { cache: "no-store" });
  } catch {
    const hit = (await cache.match(key)) || (req.mode === "navigate" && (await cache.match("index.html")));
    return hit || Response.error();
  }
  if (res.ok) await cache.put(key, res.clone());
  return res;
}

async function cachedImage(href) {
  const cache = await caches.open(IMG_CACHE);
  const hit = await cache.match(href);
  if (hit) return hit;
  try {
    // La CDN de Steam permite CORS: así la respuesta no es "opaca" y ocupa su tamaño real.
    const res = await fetch(href, { mode: "cors", credentials: "omit" });
    if (res.ok) cache.put(href, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}
