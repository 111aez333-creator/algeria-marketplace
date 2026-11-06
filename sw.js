const CACHE_NAME = 'souq-algeria-v11';
const APP_SHELL = [
  './', './index.html', './style.css', './app.js',
  './firebase-config.js', './manifest.json',
  './icon-192.png', './icon-512.png'
];
// صفحة الإدارة (admin.html / admin.js) عمداً ماشي فـ الكاش: ما تتخبّاش أبداً، ديما من الشبكة.

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      // نخبّيو كل ملف بروحو: إذا فشل ملف وحد ما يخسّرش الباقي
      .then((cache) => Promise.all(
        APP_SHELL.map((url) => cache.add(url).catch((err) => console.warn('SW: تعذر تخبئة', url, err)))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // لا نتدخلو فـ صفحة الإدارة وملفاتها
  if (/\/admin(\.html|\.js)?$/.test(url.pathname)) return;

  if (req.mode === 'navigate') {
    // نخبّيو غير الصفحة الرئيسية (/ أو /index.html) تحت مفتاح './index.html'
    const isHomeNav = /\/(index\.html)?$/.test(url.pathname);
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (isHomeNav && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(async () => (isHomeNav && (await caches.match('./index.html'))) || Response.error())
    );
    return;
  }

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req)) || Response.error())
  );
});
