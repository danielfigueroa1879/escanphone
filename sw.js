/* Service Worker — Escáner de Documentos
   Estrategia: "network-first con caché de reserva". Sirve rápido cuando hay
   internet y sigue funcionando (offline) con la última versión cacheada.

   Al subir cambios: incrementar la versión del CACHE — así todos los
   dispositivos detectan el nuevo SW, borran el caché viejo y muestran la
   última versión sin necesidad de vaciar caché a mano. */
const CACHE = 'escaner-v33';
const ASSETS = [
  './',
  'index.html',
  'css/styles.css',
  'js/scanner.js',
  'js/tools.js',
  'js/pdftools.js',
  'manifest.json',
  'favicon/web-app-manifest-192x192.png',
  'favicon/web-app-manifest-512x512.png',
  'favicon/apple-touch-icon.png',
  'favicon/favicon-96x96.png',
  'favicon/favicon.svg',
  'favicon/favicon.ico'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// La página puede pedir al SW que se active inmediatamente al detectar una
// actualización, sin esperar a que se cierren todas las pestañas.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then(r => r || caches.match('index.html')))
  );
});
