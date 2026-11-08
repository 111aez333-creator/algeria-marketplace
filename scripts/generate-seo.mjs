// يولّد صفحات ثابتة لكل إعلان منشور (l/<id>.html) + sitemap.xml + robots.txt
// باش محركات البحث ومعاينة الروابط (واتساب/فيسبوك) تشوف المحتوى. بلا مكتبات: Node 18+ فقط.
// المصدر: Firestore REST (قراءة عامة للإعلانات المنشورة فقط، ما فيه هاتف ولا بيانات خاصة).
import { writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const PROJECT_ID = process.env.PROJECT_ID || 'gallery-3008c';
const SITE_URL = (process.env.SITE_URL || 'https://111aez333-creator.github.io/-/').replace(/\/?$/, '/');
const OUT = process.env.OUT_DIR || '.';
const API_ROOT = process.env.FIRESTORE_ROOT || 'https://firestore.googleapis.com';
const CLOUD = 'prp1oxzx';
const MAX = Number(process.env.MAX_LISTINGS || 1000);
const APPCHECK_DEBUG_TOKEN = process.env.APPCHECK_DEBUG_TOKEN || '';
const FIREBASE_APP_ID = process.env.FIREBASE_APP_ID || '1:277706027135:web:85cb7d9c2737af5547cf4a';
const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyDl8NxZS0WmyjeJpnS6BVWgL3_xi4dye-E';

export const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// نتأكد أن المعرّف آمن للاستعمال كاسم ملف ورابط
export const safeId = id => /^[A-Za-z0-9_-]{1,128}$/.test(id);

export function parseValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(parseValue);
  if ('mapValue' in v) return parseFields(v.mapValue.fields || {});
  return null;
}
export function parseFields(f) { const o = {}; for (const k of Object.keys(f)) o[k] = parseValue(f[k]); return o; }

export function cldImg(u, w = 1200) {
  const p = `https://res.cloudinary.com/${CLOUD}/`;
  if (typeof u !== 'string' || !u.startsWith(p) || u.length > 500) return '';
  return u.includes('/upload/') ? u.replace('/upload/', `/upload/w_${w},c_limit,f_auto,q_auto/`) : u;
}

async function appCheckToken() {
  if (!APPCHECK_DEBUG_TOKEN) return '';
  try {
    const r = await fetch(`https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_ID}/apps/${FIREBASE_APP_ID}:exchangeDebugToken?key=${API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ debugToken: APPCHECK_DEBUG_TOKEN })
    });
    if (!r.ok) { console.warn('App Check exchange failed:', r.status); return ''; }
    return (await r.json()).token || '';
  } catch (e) { console.warn('App Check exchange error:', e.message); return ''; }
}

// يرجّع null إذا فشل الجلب (ما نمسحوش شي فـ هاذ الحالة)
export async function fetchListings() {
  const headers = { 'Content-Type': 'application/json' };
  const t = await appCheckToken(); if (t) headers['X-Firebase-AppCheck'] = t;
  const body = { structuredQuery: {
    from: [{ collectionId: 'listings' }],
    where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'published' } } },
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
    limit: MAX } };
  const r = await fetch(`${API_ROOT}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${API_KEY}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) { console.error('Firestore query failed:', r.status, (await r.text()).slice(0, 300)); return null; }
  const rows = await r.json();
  if (!Array.isArray(rows)) return null;
  return rows.filter(x => x.document).map(x => ({ id: x.document.name.split('/').pop(), ...parseFields(x.document.fields || {}), _updateTime: x.document.updateTime }));
}

export function renderPage(x) {
  const title = `${x.title} — ${Number(x.price || 0).toLocaleString('fr-DZ')} دج | سوق الجزائر`;
  const place = [x.city, x.wilaya].filter(Boolean).join('، ');
  const desc = `${x.condition || ''} ${x.category ? '• ' + x.category : ''} ${place ? '• ' + place : ''} — ${String(x.description || '').replace(/\s+/g, ' ').slice(0, 140)}`.trim();
  const imgs = (Array.isArray(x.images) ? x.images : []).map(u => cldImg(u)).filter(Boolean).slice(0, 5);
  if (!imgs.length && x.image) { const i = cldImg(x.image); if (i) imgs.push(i); }
  const url = `${SITE_URL}l/${x.id}.html`;
  const app = `${SITE_URL}?view=listing&id=${encodeURIComponent(x.id)}`;
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: x.title, description: String(x.description || '').slice(0, 500),
    ...(imgs.length ? { image: imgs } : {}), category: x.category || undefined,
    offers: { '@type': 'Offer', priceCurrency: 'DZD', price: Number(x.price || 0), url,
      availability: 'https://schema.org/InStock', itemCondition: x.condition === 'جديد' ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition' } };
  const ldJson = JSON.stringify(ld).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src https://res.cloudinary.com; base-uri 'self'">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="سوق الجزائر">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(imgs[0] || SITE_URL + 'og-image.png')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0b7a75">
<script type="application/ld+json">${ldJson}</script>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:0 auto;padding:16px;line-height:1.7;color:#0f172a}img{max-width:100%;border-radius:12px}a.btn{display:inline-block;background:#0b7a75;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700}.p{font-size:24px;font-weight:800;color:#0b7a75}</style>
</head>
<body>
<h1>${esc(x.title)}</h1>
<div class="p">${esc(Number(x.price || 0).toLocaleString('fr-DZ'))} دج</div>
<p>${esc([x.condition, x.category, place].filter(Boolean).join(' • '))}</p>
${imgs.map(i => `<img src="${esc(i)}" alt="${esc(x.title)}" loading="lazy" width="720">`).join('\n')}
<p>${esc(x.description || '').replace(/\n/g, '<br>')}</p>
<p><a class="btn" id="open" href="${esc(app)}">فتح الإعلان في سوق الجزائر</a></p>
<noscript><p>سوق الجزائر — بيع وشراء في الجزائر.</p></noscript>
<script src="go.js"></script>
</body>
</html>
`;
}

export function renderSitemap(list) {
  const urls = [`<url><loc>${esc(SITE_URL)}</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>`,
    ...list.map(x => { const lm = x._updateTime ? `<lastmod>${esc(String(x._updateTime).slice(0, 10))}</lastmod>` : ''; return `<url><loc>${esc(SITE_URL + 'l/' + x.id + '.html')}</loc>${lm}</url>`; })];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

async function main() {
  const list = await fetchListings();
  if (!list) { console.error('تخطّينا التوليد: ما قدرناش نجيبو الإعلانات (ما نمسحو والو).'); process.exit(1); }
  const good = list.filter(x => safeId(x.id) && typeof x.title === 'string' && x.title);
  const dir = join(OUT, 'l');
  await mkdir(dir, { recursive: true });
  for (const x of good) await writeFile(join(dir, `${x.id}.html`), renderPage(x));
  // نمسحو الصفحات القديمة (إعلانات اتحذفت/اتخبّات) فقط بعد جلب ناجح
  const keep = new Set(good.map(x => `${x.id}.html`));
  for (const f of await readdir(dir)) if (f.endsWith('.html') && !keep.has(f)) await unlink(join(dir, f));
  await writeFile(join(OUT, 'sitemap.xml'), renderSitemap(good));
  await writeFile(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /admin.html\n\nSitemap: ${SITE_URL}sitemap.xml\n`);
  console.log(`OK: ${good.length} صفحة`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
