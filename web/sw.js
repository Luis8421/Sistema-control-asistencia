// Service worker del Portal de Asistencia. Cachea SOLO el "app shell"
// estatico (html/css/js/iconos) para que cargue rapido e instale como
// PWA. Nunca cachea /api/ ni /uploads/: marcar asistencia siempre debe
// ir en vivo contra el backend — es la unica fuente de verdad de la
// geovalidacion (ver backend/src/utils/geo.js), cachear eso seria
// incorrecto y peligroso, no una optimizacion valida.
//
// Sube CACHE_NAME cada vez que cambie algun archivo del shell, para que
// los clientes con una version vieja en cache la reemplacen.
const CACHE_NAME = "asistencia-portal-v4";

const ARCHIVOS_APP_SHELL = [
  "marcaje.html",
  "css/style.css",
  "js/marcaje.js",
  "js/config.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Deja pasar sin interceptar: API, uploads (fotos), y cualquier cosa
  // que no sea un GET al mismo origen.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/uploads/") ||
    event.request.method !== "GET" ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // Stale-while-revalidate: responde rapido con lo que haya en cache (si
  // hay), y de fondo pide la version fresca a la red para la proxima
  // visita. Si no hay red y tampoco hay cache, el fetch simplemente falla
  // (no se promete soporte offline para el flujo de marcaje en si).
  event.respondWith(
    caches.match(event.request).then((cacheada) => {
      const actualizarDesdeRed = fetch(event.request)
        .then((respuesta) => {
          if (respuesta.ok) {
            const copia = respuesta.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
          }
          return respuesta;
        })
        .catch(() => cacheada);

      return cacheada || actualizarDesdeRed;
    })
  );
});
