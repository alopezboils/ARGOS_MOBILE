const CACHE_NAME = 'argos-cache-v2';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
    // Aquí añadiremos tus futuros archivos CSS y JS extraídos
];

// Instalación: Guardar la interfaz en el móvil
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then(cache => {
            console.log('[Obi-Wan] Caché táctica establecida.');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// Activación: Limpiar cachés antiguas si actualizamos la app
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                .map(key => caches.delete(key))
            );
        })
    );
});

// Interceptación de peticiones: Servir desde caché si es posible
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
        .then(response => {
            // Si está en la caché, devuélvelo. Si no, búscalo en la red.
            return response || fetch(event.request);
        })
    );
});
