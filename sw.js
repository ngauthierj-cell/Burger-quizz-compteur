// Fait fonctionner l'appli hors ligne une fois installée.
// Stratégie : on répond tout de suite avec la version en mémoire, et on va chercher
// une éventuelle mise à jour en arrière-plan pour le prochain lancement.
const CACHE = "miams-v6";
const FILES = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-180.png", "icons/icon-32.png", "icons/icon-maskable-192.png", "icons/icon-maskable-512.png", "qr.js", "buzzers.js"];
// Facultatifs : config.js peut manquer (pas de buzzers connectés), et la bibliothèque
// Supabase n'est utile qu'en mode buzzers. On les garde si on peut, sans bloquer.
const OPTIONAL = ["config.js", "vendor/supabase.js"];

self.addEventListener("install", (event) => {
  // « reload » : on télécharge les fichiers frais, sans passer par le cache du navigateur
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES.map((url) => new Request(url, { cache: "reload" })))
        .then(() => Promise.all(OPTIONAL.map((url) =>
          fetch(new Request(url, { cache: "reload" }))
            .then((res) => { if (res.ok) return cache.put(url, res); })
            .catch(() => {})))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req, { ignoreSearch: true }).then((cached) => {
        const update = fetch(req, { cache: "no-cache" })
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || update;
      })
    )
  );
});
