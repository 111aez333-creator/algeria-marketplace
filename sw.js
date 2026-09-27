const CACHE_NAME = 'souq-algeria-v7';
const APP_SHELL = [
  './', './index.html', './style.css', './app.js',
  './firebase-config.js', './manifest.json',
  './icon-192.png', './icon-512.png'
];
// admin.html/admin.js عمداً ماشي فـAPP_SHELL: صفحة الإدارة ما تحتاجش تخبّى offline للزوار العاديين.

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      // FIX: كنّا نستعملو cache.addAll (كل الملفات أو ولا حتى واحد)، فإذا فشل ملف
      // وحد (رابط غالط، خطأ 404...) ما كان يتخبّى حتى ملف، والباقي يبقى بلا كاش
      // بلا ما يبان أي خطأ. دابا نخبّيو كل ملف بروحو، ونكملو حتى لو ملف وحد طاح.
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

  if (req.mode === 'navigate') {
    // FIX: كنّا نخبّيو أي صفحة تنفتح بالتنقل (navigate) تحت مفتاح './index.html'،
    // يعني كي تفتح admin.html كان يبدّل محتوى الصفحة الرئيسية المخبّية بمحتوى صفحة الإدارة!
    // دابا نتحقق: كان التنقل فعلاً نحو الصفحة الرئيسية (/ أو /index.html) قبل ما نخبّيه.
    const isHomeNav = /\/(index\.html)?$/.test(url.pathname);
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (isHomeNav) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        // FIX: caches.match ممكن يرجّع undefined إذا الصفحة ماكانتش متخبّية بعد
        // (أول تحميل، أو الكاش فشل). respondWith(undefined) يطيّح خطأ
        // "Failed to convert value to 'Response'" — دابا نرجّعو Response.error() صحيحة بدلها.
        .catch(async () => (isHomeNav && (await caches.match('./index.html'))) || Response.error())
    );
    return;
  }

  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        return res;
      })
      .catch(async () => (await caches.match(req)) || Response.error())
  );
});
