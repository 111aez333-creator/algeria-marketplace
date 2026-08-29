import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  getFirestore, collection, addDoc, doc, getDoc, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit, where, onSnapshot, serverTimestamp, arrayUnion, arrayRemove,
  increment
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

const CLOUDINARY_CLOUD_NAME = 'prp1oxzx';
const CLOUDINARY_UPLOAD_PRESET = 'Storedz';

const categories = [
  ['🚗','سيارات ومركبات'],
  ['📱','هواتف وإلكترونيات'],
  ['🏠','أثاث وديكور'],
  ['👕','ملابس وأزياء'],
  ['🏢','العقار'],
  ['🛠️','الخدمات'],
  ['🌾','الفلاحة'],
  ['🏭','معدات ومهنية'],
  ['🎮','ألعاب وترفيه'],
  ['📚','كتب ودراسة'],
  ['👶','الأطفال والأم'],
  ['🐕','حيوانات'],
  ['🎁','أخرى']
];

const wilayas = [
  'أدرار','الشلف','الأغواط','أم البواقي','باتنة','بجاية','بسكرة','بشار',
  'البليدة','البويرة','تمنراست','تبسة','تلمسان','تيارت','تيزي وزو',
  'الجزائر','الجلفة','جيجل','سطيف','سعيدة','سكيكدة','سيدي بلعباس',
  'عنابة','قالمة','قسنطينة','المدية','مستغانم','المسيلة','معسكر',
  'ورقلة','وهران','البيض','إليزي','برج بوعريريج','بومرداس','الطارف',
  'تندوف','تيسمسيلت','الوادي','خنشلة','سوق أهراس','تيبازة','ميلة',
  'عين الدفلى','النعامة','عين تموشنت','غرداية','غليزان','تيميمون',
  'برج باجي مختار','أولاد جلال','بني عباس','إن صالح','إن قزام','تقرت',
  'جانت','المغير','المنيعة'
];

const SPAM_WORDS = [
  'احتيال','نصب','مخدرات','سلاح','جنس','إباحي','fake','scam'
];

const AI_CATEGORY_HINTS = {
  'سيارات': 'سيارات ومركبات',
  'هاتف': 'هواتف وإلكترونيات',
  'iphone': 'هواتف وإلكترونيات',
  'سامسونج': 'هواتف وإلكترونيات',
  'أثاث': 'أثاث وديكور',
  'كنبة': 'أثاث وديكور',
  'سرير': 'أثاث وديكور',
  'ملابس': 'ملابس وأزياء',
  'قميص': 'ملابس وأزياء',
  'عقار': 'العقار',
  'شقة': 'العقار',
  'أرض': 'العقار',
  'خدمة': 'الخدمات',
  'فلاحة': 'الفلاحة',
  'معدات': 'معدات ومهنية',
  'لعبة': 'ألعاب وترفيه',
  'كتاب': 'كتب ودراسة',
  'طفل': 'الأطفال والأم',
  'حيوان': 'حيوانات',
  'قط': 'حيوانات',
  'كلب': 'حيوانات'
};

let listings = [];
let drivers = [];
let favorites = [];
let conversations = [];
let blocked = [];
let promotions = [];
let deliveryRequests = [];
let usersList = [];
let adminDriverList = [];

let currentUser = null;
let currentProfile = null;
let isAdmin = false;
let myDriver = null;
let activeConversation = null;

let unsub = {};
let currentImages = [];

let darkMode = localStorage.getItem('darkMode') === 'true';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function escapeHtml(s = '') {
  return String(s).replace(/[&<>'"]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[c]));
}

function toast(t) {
  const x = $('#toast');
  if (!x) return;

  x.textContent = t;
  x.classList.add('show');

  clearTimeout(toast.t);
  toast.t = setTimeout(() => x.classList.remove('show'), 3000);
}

function formatPrice(v) {
  return Number(v || 0).toLocaleString('fr-DZ') + ' دج';
}

function formatDate(ts) {
  if (!ts) return '';

  const d = ts.toDate ? ts.toDate() : new Date(ts);

  return d.toLocaleDateString('ar-DZ', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function timestampMs(value) {
  if (!value) return 0;

  if (typeof value.toMillis === 'function') {
    return value.toMillis();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const n = new Date(value).getTime();

  return Number.isFinite(n) ? n : 0;
}

function newestFirst(items, field = 'createdAt') {
  return [...items].sort(
    (a, b) => timestampMs(b[field]) - timestampMs(a[field])
  );
}

function snapshotItems(snap) {
  return snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));
}

function mergeUnique(items) {
  const map = new Map();

  items.forEach(x => {
    map.set(x.id, x);
  });

  return [...map.values()];
}

function setFirebaseState(t, good = false) {
  const x = $('#firebaseState');

  if (!x) return;

  x.textContent = t;
  x.className = 'notice ' + (good ? 'notice-success' : '');
}

function requireLogin() {
  if (!currentUser) {
    toast('لازم تسجل الدخول أولاً 🔐');
    go('account');
    return false;
  }

  return true;
}

function showLoading(show) {
  const x = $('#loadingOverlay');

  if (x) {
    x.hidden = !show;
  }
}

function go(view, params = {}) {
  $$('.view').forEach(v => v.classList.remove('active'));

  const target = $(`#${view}View`);

  if (target) {
    target.classList.add('active');
  } else {
    $('#homeView')?.classList.add('active');
  }

  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });

  if (view === 'search') {
    applyFilters();
  }

  if (view === 'favorites') {
    renderFavorites();
  }

  if (view === 'admin') {
    renderAdmin();
  }

  if (view === 'account') {
    renderConversations();
    renderBlocked();
    renderMyListings();
    renderMyDeliveries();
  }

  if (view === 'delivery') {
    renderDrivers();
  }

  if (view === 'promotions') {
    renderPromotions();
  }

  if (view === 'profile' && params.uid) {
    renderProfile(params.uid);
  }

  if (view === 'tracking') {
    renderTracking();
  }

  $$('.mobile-nav button').forEach(b => {
    b.classList.toggle(
      'active',
      b.dataset.view === view
    );
  });

  const url = new URL(window.location.href);

  url.searchParams.set('view', view);

  if (params.id) {
    url.searchParams.set('id', params.id);
  }

  if (params.uid) {
    url.searchParams.set('uid', params.uid);
  }

  window.history.replaceState({}, '', url);
}

function handleUrlParams() {
  const params = new URLSearchParams(window.location.search);

  const view = params.get('view');
  const id = params.get('id');
  const uid = params.get('uid');

  if (view === 'listing' && id) {
    setTimeout(() => openListing(id), 800);
  } else if (view === 'profile' && uid) {
    go('profile', { uid });
  } else if (view && $(`#${view}View`)) {
    go(view, { id, uid });
  }
}

function initDarkMode() {
  if (darkMode) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  $('#darkModeToggle')?.addEventListener('click', () => {
    darkMode = !darkMode;

    localStorage.setItem('darkMode', darkMode);

    document.documentElement.setAttribute(
      'data-theme',
      darkMode ? 'dark' : ''
    );

    $('#darkModeToggle').textContent =
      darkMode ? '☀️' : '🌙';
  });

  if ($('#darkModeToggle')) {
    $('#darkModeToggle').textContent =
      darkMode ? '☀️' : '🌙';
  }
}

function selectOptions() {
  const opts = categories.map(
    ([i, n]) =>
      `<option value="${escapeHtml(n)}">${i} ${escapeHtml(n)}</option>`
  ).join('');

  const all = wilayas.map(
    x =>
      `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`
  ).join('');

  const fc = $('#filterCategory');
  const pc = $('#postCategory');
  const dc = $('#driverWilaya');
  const prc = $('#promoWilaya');

  if (fc) {
    fc.innerHTML =
      '<option value="">كل الأقسام</option>' + opts;
  }

  if (pc) {
    pc.innerHTML =
      '<option value="">اختار القسم</option>' + opts;
  }

  if (dc) {
    dc.innerHTML =
      '<option value="">اختار الولاية</option>' + all;
  }

  if (prc) {
    prc.innerHTML =
      '<option value="">اختار الولاية</option>' + all;
  }

  const fw = $('#filterWilaya');
  const pw = $('#postWilaya');

  if (fw) {
    fw.innerHTML =
      '<option value="">كل الولايات</option>' + all;
  }

  if (pw) {
    pw.innerHTML =
      '<option value="">اختار الولاية</option>' + all;
  }
}

function categoryCards(target) {
  const el = $(target);

  if (!el) return;

  el.innerHTML = categories.map(
    ([icon, name]) =>
      `<button class="category" data-cat="${escapeHtml(name)}">
        <span class="icon">${icon}</span>
        <b>${escapeHtml(name)}</b>
      </button>`
  ).join('');

  $$(target + ' .category').forEach(b => {
    b.onclick = () => {
      go('search');

      if ($('#filterCategory')) {
        $('#filterCategory').value = b.dataset.cat;
      }

      applyFilters();
    };
  });
}

function cloudinaryUrl(url, w = 800, h = 600) {
  if (!url || !url.includes('res.cloudinary.com')) {
    return url;
  }

  return url.replace(
    '/upload/',
    `/upload/f_auto,q_auto,w_${w},h_${h},c_limit/`
  );
}

async function uploadImageToCloudinary(file) {
  if (!file) return '';

  if (
    CLOUDINARY_CLOUD_NAME.startsWith('YOUR_') ||
    CLOUDINARY_UPLOAD_PRESET.startsWith('YOUR_')
  ) {
    throw new Error('كمّل إعداد Cloudinary أولاً.');
  }

  const allowed = [
    'image/jpeg',
    'image/png',
    'image/webp'
  ];

  if (!allowed.includes(file.type)) {
    throw new Error('استعمل JPG أو PNG أو WebP.');
  }

  if (file.size > 8 * 1024 * 1024) {
    throw new Error('الصورة كبيرة بزاف. الحد الأقصى 8MB.');
  }

  const form = new FormData();

  form.append('file', file);
  form.append(
    'upload_preset',
    CLOUDINARY_UPLOAD_PRESET
  );
  form.append(
    'folder',
    'souq-algeria/listings'
  );

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(
      CLOUDINARY_CLOUD_NAME
    )}/image/upload`,
    {
      method: 'POST',
      body: form
    }
  );

  const data = await res.json();

  if (!res.ok || !data.secure_url) {
    throw new Error(
      data.error?.message ||
      'فشل رفع الصورة.'
    );
  }

  return data.secure_url;
}

function statusMeta(d) {
  const s =
    d.activityStatus === 'active'
      ? 'active'
      : d.activityStatus === 'busy'
        ? 'busy'
        : 'offline';

  const label =
    s === 'active'
      ? 'متصل الآن'
      : s === 'busy'
        ? 'مشغول'
        : 'غير متصل';

  const lastSeen =
    d.lastSeenAt
      ? new Date(
          timestampMs(d.lastSeenAt)
        ).toLocaleString('ar-DZ', {
          dateStyle: 'medium',
          timeStyle: 'short'
        })
      : '';

  return {
    s,
    label,
    lastSeen
  };
}

function card(x) {
  const active =
    favorites.includes(x.id) ||
    favorites.includes(String(x.id));

  const img =
    x.images?.[0] ||
    x.image ||
    '';

  const rating =
    x.ratingCount
      ? (x.ratingSum / x.ratingCount).toFixed(1)
      : null;

  return `
  <article class="listing" data-id="${escapeHtml(x.id)}">

    <div class="listing-img">

      ${
        img
          ? `<img
              src="${escapeHtml(
                cloudinaryUrl(img, 600, 450)
              )}"
              alt="${escapeHtml(x.title)}"
              loading="lazy"
              decoding="async"
            >`
          : escapeHtml(x.emoji || '🛍️')
      }

      <button
        class="heart ${active ? 'active' : ''}"
        data-fav="${escapeHtml(x.id)}"
        title="المفضلة"
        aria-label="المفضلة"
      >
        ${active ? '♥' : '♡'}
      </button>

    </div>

    <div class="listing-body">

      <div class="meta">
        ${escapeHtml(x.condition || 'متاح')}
        •
        ${escapeHtml(x.category || '')}
        ${
          x.sellerVerified
            ? ' • ✓ بائع موثّق'
            : ''
        }
      </div>

      <div class="listing-title">
        ${escapeHtml(x.title)}
      </div>

      <div class="price">
        ${formatPrice(x.price)}
      </div>

      <div class="meta">
        📍 ${escapeHtml(x.wilaya || 'الجزائر')}
        ${x.city ? ' — ' + escapeHtml(x.city) : ''}
        • 👤 ${escapeHtml(x.seller || 'بائع')}
      </div>

      <div
        style="
          display:flex;
          gap:6px;
          flex-wrap:wrap;
          margin-top:4px
        "
      >

        ${
          x.delivery
            ? '<span class="delivery-chip">🚗 توصيل</span>'
            : ''
        }

        ${
          x.showPhone
            ? '<span class="delivery-chip" style="background:#dbeafe;color:#1d4ed8">📞 هاتف</span>'
            : ''
        }

        ${
          rating
            ? `<span class="rating-display">⭐ ${rating}</span>`
            : ''
        }

        ${
          x.views
            ? `<span class="meta">👁️ ${Number(
                x.views
              ).toLocaleString('fr-DZ')}</span>`
            : ''
        }

      </div>

    </div>

  </article>
  `;
}

function renderListings(items, target) {
  const el = $(target);

  if (!el) return;

  if (!items.length) {
    el.innerHTML =
      '<div class="empty">لا توجد إعلانات حالياً.</div>';
    return;
  }

  el.innerHTML = items.map(card).join('');

  $$(target + ' .listing').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('[data-fav]')) return;

      openListing(el.dataset.id);
    });
  });

  $$(target + ' [data-fav]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleFavorite(btn.dataset.fav);
    });
  });
}

async function ensureUserProfile(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const profile = {
      uid: user.uid,
      displayName:
        user.displayName ||
        'مستخدم',
      email: user.email || '',
      photoURL: user.photoURL || '',
      role: 'user',
      verified: false,
      favoriteIds: [],
      ratingCount: 0,
      ratingSum: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(ref, profile);

    return {
      ...profile,
      createdAt: new Date()
    };
  }

  return snap.data();
}

async function loginGoogle() {
  try {
    showLoading(true);

    await signInWithPopup(
      auth,
      googleProvider
    );

    toast('تم تسجيل الدخول بنجاح ✅');
  } catch (e) {
    console.error(e);

    if (
      e.code ===
      'auth/popup-closed-by-user'
    ) {
      toast('تم إغلاق نافذة تسجيل الدخول.');
    } else {
      toast(
        'تعذر تسجيل الدخول: ' +
        (e.message || 'خطأ غير معروف')
      );
    }
  } finally {
    showLoading(false);
  }
}

async function logout() {
  try {
    await signOut(auth);
    toast('تم تسجيل الخروج.');
  } catch (e) {
    console.error(e);
    toast('تعذر تسجيل الخروج.');
  }
}

async function toggleFavorite(id) {
  if (!requireLogin()) return;

  const key = String(id);

  const exists =
    favorites.includes(id) ||
    favorites.includes(key);

  try {
    const ref = doc(db, 'users', currentUser.uid);

    if (exists) {
      favorites = favorites.filter(
        x => String(x) !== key
      );

      await updateDoc(ref, {
        favoriteIds: arrayRemove(id),
        updatedAt: serverTimestamp()
      });
    } else {
      favorites.push(id);

      await updateDoc(ref, {
        favoriteIds: arrayUnion(id),
        updatedAt: serverTimestamp()
      });
    }

    renderAll();
    toast(
      exists
        ? 'تم حذف الإعلان من المفضلة.'
        : 'تمت إضافة الإعلان للمفضلة ❤️'
    );
  } catch (e) {
    console.error(e);
    toast('تعذر تحديث المفضلة.');
  }
}

function renderFavorites() {
  renderListings(
    listings.filter(
      x =>
        favorites.includes(x.id) ||
        favorites.includes(String(x.id))
    ),
    '#favoritesGrid'
  );
}

function applyFilters() {
  const q =
    $('#globalSearch')?.value
      .trim()
      .toLowerCase() || '';

  const cat =
    $('#filterCategory')?.value || '';

  const w =
    $('#filterWilaya')?.value || '';

  const city =
    $('#filterCity')?.value
      .trim()
      .toLowerCase() || '';

  const cond =
    $('#filterCondition')?.value || '';

  const min =
    Number($('#minPrice')?.value || 0);

  const max =
    Number(
      $('#maxPrice')?.value ||
      Infinity
    );

  const delivery =
    $('#filterDelivery')?.checked || false;

  const verified =
    $('#filterVerified')?.checked || false;

  const sort =
    $('#sortResults')?.value || 'new';

  let arr = listings.filter(x => {
    const text = `
      ${x.title}
      ${x.category}
      ${x.wilaya}
      ${x.city || ''}
      ${x.description || ''}
    `.toLowerCase();

    return (
      (!q || text.includes(q)) &&
      (!cat || x.category === cat) &&
      (!w || x.wilaya === w) &&
      (
        !city ||
        (x.city || '')
          .toLowerCase()
          .includes(city)
      ) &&
      (!cond || x.condition === cond) &&
      Number(x.price) >= min &&
      Number(x.price) <= max &&
      (!delivery || x.delivery) &&
      (!verified || x.sellerVerified)
    );
  });

  if (sort === 'low') {
    arr.sort(
      (a, b) =>
        Number(a.price) -
        Number(b.price)
    );
  }

  if (sort === 'high') {
    arr.sort(
      (a, b) =>
        Number(b.price) -
        Number(a.price)
    );
  }

  if (sort === 'views') {
    arr.sort(
      (a, b) =>
        (b.views || 0) -
        (a.views || 0)
    );
  }

  if (sort === 'new') {
    arr = newestFirst(arr);
  }

  if ($('#searchTitle')) {
    $('#searchTitle').textContent =
      q
        ? `نتائج: ${q}`
        : cat || 'كل الإعلانات';
  }

  if ($('#resultCount')) {
    $('#resultCount').textContent =
      `${arr.length} إعلان`;
  }

  renderListings(
    arr,
    '#resultsGrid'
  );
}

async function openListing(id) {
  const x =
    listings.find(
      i => String(i.id) === String(id)
    );

  if (!x) return;

  const seenKey =
    'viewed_' + id;

  if (
    currentUser &&
    !sessionStorage.getItem(seenKey)
  ) {
    sessionStorage.setItem(
      seenKey,
      '1'
    );

    try {
      await updateDoc(
        doc(db, 'listings', id),
        {
          views: increment(1)
        }
      );

      x.views =
        (x.views || 0) + 1;
    } catch {}
  }

  const owner = x.ownerUid;

  const current =
    owner === currentUser?.uid;

  const img =
    x.images?.[0] ||
    x.image ||
    '';

  const allImages =
    x.images?.length
      ? x.images
      : x.image
        ? [x.image]
        : [];

  const rating =
    x.ratingCount
      ? (
          x.ratingSum /
          x.ratingCount
        ).toFixed(1)
      : null;

  const shareUrl =
    `${window.location.origin}` +
    `${window.location.pathname}` +
    `?view=listing&id=${x.id}`;

  let galleryHtml = '';

  if (allImages.length > 1) {
    galleryHtml = `
      <div
        class="gallery-main"
        id="galleryMain"
      >
        ${
          img
            ? `<img
                src="${escapeHtml(
                  cloudinaryUrl(
                    img,
                    1000,
                    800
                  )
                )}"
                alt="${escapeHtml(x.title)}"
              >`
            : escapeHtml(
                x.emoji || '🛍️'
              )
        }
      </div>

      <div class="gallery-thumbs">
        ${allImages.map(
          (u, i) =>
            `<img
              src="${escapeHtml(
                cloudinaryUrl(
                  u,
                  200,
                  200
                )
              )}"
              class="${i === 0 ? 'active' : ''}"
              data-index="${i}"
              data-full="${escapeHtml(u)}"
            >`
        ).join('')}
      </div>
    `;
  } else {
    galleryHtml = `
      <div class="gallery-main">
        ${
          img
            ? `<img
                src="${escapeHtml(
                  cloudinaryUrl(
                    img,
                    1000,
                    800
                  )
                )}"
                alt="${escapeHtml(x.title)}"
              >`
            : escapeHtml(
                x.emoji || '🛍️'
              )
        }
      </div>
    `;
  }

  const modal = $('#listingModal');

  if (!modal) return;

  modal.innerHTML = `
    <div class="modal-content listing-modal-content">

      <button
        class="modal-close"
        data-close-modal
        aria-label="إغلاق"
      >
        ×
      </button>

      <div class="listing-detail">

        <div class="listing-gallery">
          ${galleryHtml}
        </div>

        <div class="listing-detail-body">

          <div class="meta">
            ${escapeHtml(
              x.condition || 'متاح'
            )}
            •
            ${escapeHtml(
              x.category || ''
            )}

            ${
              x.sellerVerified
                ? ' • ✓ بائع موثّق'
                : ''
            }
          </div>

          <h2>
            ${escapeHtml(x.title)}
          </h2>

          <div class="price">
            ${formatPrice(x.price)}
          </div>

          <div class="meta">
            📍
            ${escapeHtml(
              x.wilaya || 'الجزائر'
            )}
            ${
              x.city
                ? ' — ' +
                  escapeHtml(x.city)
                : ''
            }
          </div>

          <div class="listing-description">
            ${escapeHtml(
              x.description || 'لا يوجد وصف.'
            )}
          </div>

          <div class="listing-meta-grid">

            <div>
              <b>البائع</b>
              <span>
                ${escapeHtml(
                  x.seller || 'بائع'
                )}
              </span>
            </div>

            <div>
              <b>المشاهدات</b>
              <span>
                ${Number(
                  x.views || 0
                ).toLocaleString('fr-DZ')}
              </span>
            </div>

            ${
              rating
                ? `
                  <div>
                    <b>التقييم</b>
                    <span>⭐ ${rating}</span>
                  </div>
                `
                : ''
            }

          </div>

          <div class="listing-actions">

            ${
              !current
                ? `
                  <button
                    class="primary-btn"
                    data-chat-owner="${escapeHtml(owner)}"
                  >
                    💬 مراسلة البائع
                  </button>
                `
                : ''
            }

            ${
              x.showPhone &&
              x.phone
                ? `
                  <a
                    class="secondary-btn"
                    href="tel:${escapeHtml(x.phone)}"
                  >
                    📞 اتصال
                  </a>
                `
                : ''
            }

            <button
              class="secondary-btn"
              data-share-listing="${escapeHtml(
                shareUrl
              )}"
            >
              🔗 مشاركة
            </button>

            ${
              !current
                ? `
                  <button
                    class="secondary-btn"
                    data-report-listing="${escapeHtml(x.id)}"
                  >
                    🚩 بلاغ
                  </button>
                `
                : ''
            }

          </div>

          ${
            x.delivery
              ? `
                <div class="notice notice-success">
                  🚗 هذا الإعلان يدعم التوصيل.
                </div>
              `
              : ''
          }

        </div>

      </div>
    </div>
  `;

  modal.hidden = false;

  modal
    .querySelector(
      '[data-close-modal]'
    )
    ?.addEventListener(
      'click',
      closeModal
    );

  modal
    .querySelector(
      '[data-share-listing]'
    )
    ?.addEventListener(
      'click',
      async e => {
        const url =
          e.currentTarget.dataset
            .shareListing;

        try {
          if (navigator.share) {
            await navigator.share({
              title: x.title,
              text:
                `${x.title} - ` +
                `${formatPrice(x.price)}`,
              url
            });
          } else {
            await navigator.clipboard.writeText(
              url
            );

            toast(
              'تم نسخ رابط الإعلان 🔗'
            );
          }
        } catch {}
      }
    );

  modal
    .querySelector(
      '[data-chat-owner]'
    )
    ?.addEventListener(
      'click',
      () => {
        closeModal();

        startConversation(
          owner,
          x.id
        );
      }
    );

  modal
    .querySelector(
      '[data-report-listing]'
    )
    ?.addEventListener(
      'click',
      () => {
        closeModal();
        openReport(
          'listing',
          x.id
        );
      }
    );

  $$('.gallery-thumbs img').forEach(
    thumb => {
      thumb.addEventListener(
        'click',
        () => {
          const full =
            thumb.dataset.full;

          const main =
            $('#galleryMain img');

          if (main) {
            main.src =
              cloudinaryUrl(
                full,
                1000,
                800
              );
          }

          $$('.gallery-thumbs img')
            .forEach(
              x =>
                x.classList.remove(
                  'active'
                )
            );

          thumb.classList.add(
            'active'
          );
        }
      );
    }
  );
}

function closeModal() {
  const modal =
    $('#listingModal');

  if (modal) {
    modal.hidden = true;
  }
}

async function submitListing(e) {
  e.preventDefault();

  if (!requireLogin()) return;

  const f =
    new FormData(e.target);

  const title =
    String(
      f.get('title') || ''
    ).trim();

  const price =
    Number(
      f.get('price') || 0
    );

  if (!title) {
    toast('اكتب عنوان الإعلان.');
    return;
  }

  if (!price || price < 0) {
    toast('أدخل سعرًا صحيحًا.');
    return;
  }

  let images = [
    ...currentImages
  ];

  const urlInput =
    String(
      f.get('imageUrls') || ''
    ).trim();

  if (urlInput) {
    const urls =
      urlInput
        .split(',')
        .map(u => u.trim())
        .filter(validUrl);

    images =
      images.concat(urls);
  }

  const item = {
    title,
    price,
    category: f.get('category'),
    wilaya: f.get('wilaya'),
    city: String(
      f.get('city') || ''
    ).trim(),
    condition: f.get('condition'),
    delivery:
      f.get('delivery') !==
      'يد بيد',

    images:
      images.slice(0, 5),

    image:
      images[0] || '',

    emoji: '🛍️',

    seller:
      currentProfile?.displayName ||
      currentUser.displayName ||
      'بائع',

    sellerVerified:
      currentProfile?.verified ||
      false,

    ownerUid:
      currentUser.uid,

    description:
      String(
        f.get('description') || ''
      ).trim(),

    phone:
      String(
        f.get('phone') || ''
      ).trim(),

    showPhone:
      f.get('showPhone') !== null,

    status: 'published',

    views: 0,

    ratingCount: 0,
    ratingSum: 0,

    createdAt:
      serverTimestamp(),

    updatedAt:
      serverTimestamp()
  };

  try {
    await addDoc(
      collection(db, 'listings'),
      item
    );

    e.target.reset();

    currentImages = [];

    if ($('#imagePreviewGrid')) {
      $('#imagePreviewGrid').innerHTML = '';
    }

    toast(
      'تم نشر الإعلان بنجاح ✅'
    );

    go('home');

  } catch (err) {
    console.error(err);

    toast(
      'فشل نشر الإعلان: ' +
      (err.code || 'تحقق من Rules')
    );
  }
}

function validUrl(url) {
  try {
    const u =
      new URL(url);

    return (
      u.protocol === 'http:' ||
      u.protocol === 'https:'
    );
  } catch {
    return false;
  }
}

function subscribeData() {

  /*
   * مهم:
   * لا نستعمل orderBy مع where هنا.
   * نجيب البيانات باستعلام بسيط ثم نرتبها محلياً.
   * هذا يقلل الحاجة إلى Composite Index.
   */

  if (unsub.listings) {
    unsub.listings();
  }

  unsub.listings =
    onSnapshot(
      query(
        collection(db, 'listings'),
        where(
          'status',
          '==',
          'published'
        ),
        limit(200)
      ),

      s => {
        listings =
          newestFirst(
            snapshotItems(s)
          );

        renderAll();

        if (
          $('#searchView')?.classList.contains(
            'active'
          )
        ) {
          applyFilters();
        }
      },

      e => {
        console.error(
          'listings:',
          e
        );

        toast(
          'تعذر قراءة الإعلانات.'
        );
      }
    );

  if (unsub.drivers) {
    unsub.drivers();
  }

  unsub.drivers =
    onSnapshot(
      query(
        collection(db, 'drivers'),
        where(
          'status',
          '==',
          'approved'
        ),
        where(
          'verified',
          '==',
          true
        ),
        limit(100)
      ),

      s => {
        const now =
          Date.now();

        drivers =
          snapshotItems(s).map(
            d => {
              const seen =
                timestampMs(
                  d.lastSeenAt
                );

              if (
                d.activityStatus ===
                  'active' &&
                seen &&
                now - seen >
                  150000
              ) {
                d.activityStatus =
                  'offline';
              }

              return d;
            }
          );

        renderDrivers();
        renderMyDriver();

        if ($('#statDrivers')) {
          $('#statDrivers').textContent =
            drivers.length;
        }
      },

      e =>
        console.error(
          'drivers:',
          e
        )
    );

  if (unsub.promotions) {
    unsub.promotions();
  }

  unsub.promotions =
    onSnapshot(
      query(
        collection(db, 'promotions'),
        where(
          'status',
          '==',
          'approved'
        ),
        limit(100)
      ),

      s => {
        promotions =
          newestFirst(
            snapshotItems(s)
          ).slice(0, 20);

        renderPromotions();
      },

      e =>
        console.error(
          'promotions:',
          e
        )
    );
}

function subscribeMine() {

  if (!currentUser) return;

  if (unsub.myDriver) {
    unsub.myDriver();
  }

  unsub.myDriver =
    onSnapshot(
      query(
        collection(db, 'drivers'),
        where(
          'ownerUid',
          '==',
          currentUser.uid
        ),
        limit(5)
      ),

      s => {
        const items =
          newestFirst(
            snapshotItems(s)
          );

        myDriver =
          items[0] || null;

        renderMyDriver();
      },

      e =>
        console.error(
          'myDriver:',
          e
        )
    );

  if (unsub.conversations) {
    unsub.conversations();
  }

  /*
   * تم إزالة orderBy من نفس الاستعلام
   * حتى لا نحتاج Composite Index.
   */
  unsub.conversations =
    onSnapshot(
      query(
        collection(
          db,
          'conversations'
        ),
        where(
          'participants',
          'array-contains',
          currentUser.uid
        ),
        limit(100)
      ),

      s => {
        conversations =
          newestFirst(
            snapshotItems(s),
            'updatedAt'
          ).slice(0, 30);

        renderConversations();
      },

      e =>
        console.error(
          'conversations:',
          e
        )
    );

  if (unsub.blocks) {
    unsub.blocks();
  }

  unsub.blocks =
    onSnapshot(
      query(
        collection(db, 'blocks'),
        where(
          'blockerUid',
          '==',
          currentUser.uid
        ),
        limit(100)
      ),

      s => {
        blocked =
          snapshotItems(s);

        renderBlocked();
      },

      e =>
        console.error(
          'blocks:',
          e
        )
    );

  if (unsub.deliveryRequests) {
    unsub.deliveryRequests();
  }

  unsub.deliveryRequests =
    onSnapshot(
      query(
        collection(
          db,
          'deliveryRequests'
        ),
        where(
          'buyerUid',
          '==',
          currentUser.uid
        ),
        limit(100)
      ),

      s => {
        deliveryRequests =
          newestFirst(
            snapshotItems(s),
            'createdAt'
          );

        renderTracking();
        renderMyDeliveries();
      },

      e =>
        console.error(
          'deliveryRequests:',
          e
        )
    );
}

async function renderAdmin() {

  if (!isAdmin) {
    if ($('#adminView .page-heading p')) {
      $('#adminView .page-heading p').textContent =
        'هذا القسم خاص بالإدارة فقط.';
    }

    return;
  }

  if ($('#adminView .page-heading p')) {
    $('#adminView .page-heading p').textContent =
      'أنت داخل وضع الإدارة. العمليات الحساسة محمية بقواعد Firestore.';
  }

  $('#adminListings').innerHTML =
    listings
      .slice(0, 30)
      .map(
        x =>
          `
          <div class="admin-item">

            <b>
              ${escapeHtml(x.title)}
            </b>

            <div class="meta">
              ${escapeHtml(
                x.seller || ''
              )}
              •
              ${formatPrice(x.price)}
            </div>

            <div class="admin-item-actions">

              <button
                class="small-btn danger"
                data-admin-delete-listing="${escapeHtml(
                  x.id
                )}"
              >
                حذف
              </button>

              <button
                class="small-btn"
                data-admin-report-listing="${escapeHtml(
                  x.id
                )}"
              >
                فتح بلاغ
              </button>

            </div>

          </div>
          `
      )
      .join('') ||
    '<div class="empty">لا توجد إعلانات.</div>';

  $$(
    '[data-admin-delete-listing]'
  ).forEach(b => {
    b.onclick = async () => {

      if (!confirm('حذف الإعلان؟')) {
        return;
      }

      try {
        await deleteDoc(
          doc(
            db,
            'listings',
            b.dataset
              .adminDeleteListing
          )
        );

        toast(
          'تم حذف الإعلان.'
        );
      } catch (e) {
        console.error(e);
        toast(
          'تعذر حذف الإعلان.'
        );
      }
    };
  });

  if (unsub.adminDrivers) {
    unsub.adminDrivers();
  }

  unsub.adminDrivers =
    onSnapshot(
      query(
        collection(
          db,
          'drivers'
        ),
        limit(200)
      ),

      s => {

        adminDriverList =
          newestFirst(
            snapshotItems(s)
          );

        const ds =
          adminDriverList.slice(
            0,
            50
          );

        const el =
          $('#adminDrivers');

        if (!el) return;

        el.innerHTML =
          ds
            .map(
              d =>
                `
                <div class="admin-item">

                  <b>
                    ${escapeHtml(
                      d.name ||
                      'موصل'
                    )}
                  </b>

                  <div class="meta">
                    ${escapeHtml(
                      d.wilaya || ''
                    )}
                    •
                    ${escapeHtml(
                      d.status ||
                      'pending'
                    )}
                    ${
                      d.verified
                        ? ' • ✓ موثّق'
                        : ''
                    }
                  </div>

                  <div class="admin-item-actions">

                    ${
                      d.status !==
                      'approved'
                        ? `
                          <button
                            class="small-btn success"
                            data-driver-approve="${d.id}"
                          >
                            قبول
                          </button>
                        `
                        : `
                          <button
                            class="small-btn danger"
                            data-driver-reject="${d.id}"
                          >
                            إيقاف
                          </button>
                        `
                    }

                  </div>

                </div>
                `
            )
            .join('') ||
          '<div class="empty">لا توجد طلبات موصلين.</div>';

        $$(
          '[data-driver-approve]'
        ).forEach(b => {
          b.onclick = () =>
            adminDriver(
              b.dataset
                .driverApprove,
              'approved',
              true
            );
        });

        $$(
          '[data-driver-reject]'
        ).forEach(b => {
          b.onclick = () =>
            adminDriver(
              b.dataset
                .driverReject,
              'rejected',
              false
            );
        });
      },

      e => {
        console.error(
          'adminDrivers:',
          e
        );

        toast(
          'تعذر قراءة طلبات الموصلين.'
        );
      }
    );

  if (unsub.adminReports) {
    unsub.adminReports();
  }

  unsub.adminReports =
    onSnapshot(
      query(
        collection(
          db,
          'reports'
        ),
        where(
          'status',
          '==',
          'open'
        ),
        limit(100)
      ),

      s => {

        const reports =
          newestFirst(
            snapshotItems(s)
          ).slice(0, 100);

        if ($('#statReports')) {
          $('#statReports').textContent =
            reports.length;
        }

        if ($('#adminReports')) {
          $('#adminReports').innerHTML =
            reports
              .map(
                r =>
                  `
                  <div class="admin-item">

                    <b>
                      ${escapeHtml(
                        r.reason ||
                        'بلاغ'
                      )}
                    </b>

                    <div class="meta">
                      ${escapeHtml(
                        r.targetType ||
                        ''
                      )}
                      •
                      ${escapeHtml(
                        r.details ||
                        ''
                      )}
                    </div>

                    <div class="admin-item-actions">

                      <button
                        class="small-btn success"
                        data-report-close="${r.id}"
                      >
                        إغلاق
                      </button>

                    </div>

                  </div>
                  `
              )
              .join('') ||
            '<div class="empty">لا توجد بلاغات مفتوحة.</div>';
        }

        $$(
          '[data-report-close]'
        ).forEach(b => {
          b.onclick = async () => {
            try {
              await updateDoc(
                doc(
                  db,
                  'reports',
                  b.dataset
                    .reportClose
                ),
                {
                  status: 'closed',
                  updatedAt:
                    serverTimestamp()
                }
              );

              toast(
                'تم إغلاق البلاغ.'
              );
            } catch (e) {
              console.error(e);
              toast(
                'تعذر إغلاق البلاغ.'
              );
            }
          };
        });
      }
    );

  if (unsub.deliveryAdmin) {
    unsub.deliveryAdmin();
  }

  unsub.deliveryAdmin =
    onSnapshot(
      query(
        collection(
          db,
          'deliveryRequests'
        ),
        where(
          'status',
          '==',
          'pending'
        ),
        limit(100)
      ),

      s => {
        if ($('#statDeliveryRequests')) {
          $('#statDeliveryRequests').textContent =
            s.size;
        }
      }
    );

  if (unsub.adminUsers) {
    unsub.adminUsers();
  }

  unsub.adminUsers =
    onSnapshot(
      query(
        collection(
          db,
          'users'
        ),
        limit(200)
      ),

      s => {

        const us =
          newestFirst(
            snapshotItems(s)
          ).slice(0, 100);

        usersList = us;

        if ($('#statUsers')) {
          $('#statUsers').textContent =
            us.length;
        }

        if ($('#adminUsers')) {
          $('#adminUsers').innerHTML =
            us
              .map(
                u =>
                  `
                  <div class="admin-item">

                    <b>
                      ${escapeHtml(
                        u.displayName ||
                        'مستخدم'
                      )}
                    </b>

                    <div class="meta">
                      ${escapeHtml(
                        u.email || ''
                      )}
                      •
                      ${escapeHtml(
                        u.role ||
                        'user'
                      )}
                    </div>

                    <div class="admin-item-actions">

                      ${
                        u.role !==
                        'admin'
                          ? `
                            <button
                              class="small-btn success"
                              data-make-admin="${u.id}"
                            >
                              تعيين أدمن
                            </button>
                          `
                          : ''
                      }

                      <button
                        class="small-btn danger"
                        data-verify-user="${u.id}"
                      >
                        ${
                          u.verified
                            ? 'إلغاء توثيق'
                            : 'توثيق'
                        }
                      </button>

                    </div>

                  </div>
                  `
              )
              .join('') ||
            '<div class="empty">لا يوجد مستخدمون.</div>';
        }

        $$(
          '[data-make-admin]'
        ).forEach(b => {
          b.onclick = async () => {

            try {
              await updateDoc(
                doc(
                  db,
                  'users',
                  b.dataset
                    .makeAdmin
                ),
                {
                  role: 'admin',
                  updatedAt:
                    serverTimestamp()
                }
              );

              toast(
                'تم تعيين الأدمن.'
              );
            } catch (e) {
              console.error(e);
              toast(
                'تعذر تعديل الحساب.'
              );
            }
          };
        });

        $$(
          '[data-verify-user]'
        ).forEach(b => {
          b.onclick = async () => {

            try {
              const ref =
                doc(
                  db,
                  'users',
                  b.dataset
                    .verifyUser
                );

              const snap =
                await getDoc(ref);

              const v =
                snap.data()?.verified;

              await updateDoc(
                ref,
                {
                  verified: !v,
                  updatedAt:
                    serverTimestamp()
                }
              );

              toast(
                v
                  ? 'تم إلغاء التوثيق.'
                  : 'تم توثيق الحساب.'
              );

            } catch (e) {
              console.error(e);
              toast(
                'تعذر تحديث التوثيق.'
              );
            }
          };
        });
      }
    );

  if (unsub.adminPromotions) {
    unsub.adminPromotions();
  }

  unsub.adminPromotions =
    onSnapshot(
      query(
        collection(
          db,
          'promotions'
        ),
        where(
          'status',
          '==',
          'pending'
        ),
        limit(100)
      ),

      s => {

        const pr =
          newestFirst(
            snapshotItems(s)
          ).slice(0, 100);

        if ($('#statPromotions')) {
          $('#statPromotions').textContent =
            pr.length;
        }

        if ($('#adminPromotions')) {
          $('#adminPromotions').innerHTML =
            pr
              .map(
                p =>
                  `
                  <div class="admin-item">

                    <b>
                      ${escapeHtml(
                        p.name
                      )}
                    </b>

                    <div class="meta">
                      ${escapeHtml(
                        p.type || ''
                      )}
                      •
                      ${escapeHtml(
                        p.wilaya || ''
                      )}
                    </div>

                    <div class="admin-item-actions">

                      <button
                        class="small-btn success"
                        data-promo-approve="${p.id}"
                      >
                        قبول
                      </button>

                      <button
                        class="small-btn danger"
                        data-promo-reject="${p.id}"
                      >
                        رفض
                      </button>

                    </div>

                  </div>
                  `
              )
              .join('') ||
            '<div class="empty">لا توجد ترويجات قيد المراجعة.</div>';
        }

        $$(
          '[data-promo-approve]'
        ).forEach(b => {
          b.onclick = async () => {
            try {
              await updateDoc(
                doc(
                  db,
                  'promotions',
                  b.dataset
                    .promoApprove
                ),
                {
                  status:
                    'approved',
                  updatedAt:
                    serverTimestamp()
                }
              );

              toast(
                'تم قبول الترويج.'
              );
            } catch (e) {
              console.error(e);
              toast(
                'تعذر قبول الترويج.'
              );
            }
          };
        });

        $$(
          '[data-promo-reject]'
        ).forEach(b => {
          b.onclick = async () => {
            try {
              await updateDoc(
                doc(
                  db,
                  'promotions',
                  b.dataset
                    .promoReject
                ),
                {
                  status:
                    'rejected',
                  updatedAt:
                    serverTimestamp()
                }
              );

              toast(
                'تم رفض الترويج.'
              );
            } catch (e) {
              console.error(e);
              toast(
                'تعذر رفض الترويج.'
              );
            }
          };
        });
      }
    );

  const aiAlerts = [];

  listings
    .slice(0, 20)
    .forEach(l => {

      const text =
        (
          l.title +
          ' ' +
          (l.description || '')
        ).toLowerCase();

      if (
        SPAM_WORDS.some(
          w =>
            text.includes(w)
        )
      ) {
        aiAlerts.push(
          `⚠️ إعلان مشبوه: "${l.title}"`
        );
      }

      const duplicate =
        listings.filter(
          x =>
            x.id !== l.id &&
            x.title &&
            l.title &&
            x.title.toLowerCase() ===
              l.title.toLowerCase()
        );

      if (duplicate.length) {
        aiAlerts.push(
          `🔁 تكرار محتمل: "${l.title}"`
        );
      }
    });

  if ($('#aiAdminAlerts')) {
    $('#aiAdminAlerts').innerHTML =
      aiAlerts.length
        ? aiAlerts
            .map(
              a =>
                `
                <div
                  class="admin-item"
                  style="border-color:var(--warning)"
                >
                  <div class="meta">
                    ${escapeHtml(a)}
                  </div>
                </div>
                `
            )
            .join('')
        : '<div class="empty small-empty">لا توجد تنبيهات حالياً.</div>';
  }
}

async function adminDriver(
  id,
  status,
  verified
) {
  try {

    await updateDoc(
      doc(
        db,
        'drivers',
        id
      ),
      {
        status,
        verified,
        updatedAt:
          serverTimestamp()
      }
    );

    toast(
      status === 'approved'
        ? 'تم قبول الموصل ✅'
        : 'تم إيقاف الموصل.'
    );

  } catch (e) {
    console.error(e);

    toast(
      'تعذر تحديث الموصل.'
    );
  }
}

function renderPromotions() {
  const el =
    $('#promoGrid');

  if (!el) return;

  const approved =
    promotions.filter(
      p =>
        p.status ===
        'approved'
    );

  el.innerHTML =
    approved.length
      ? approved
          .map(
            p =>
              `
              <div class="promo-card">

                ${
                  p.image
                    ? `<img
                        src="${escapeHtml(
                          cloudinaryUrl(
                            p.image,
                            200,
                            200
                          )
                        )}"
                        alt=""
                      >`
                    : '<div style="font-size:40px">📣</div>'
                }

                <h3>
                  ${escapeHtml(
                    p.name
                  )}
                </h3>

                <div class="meta">
                  ${escapeHtml(
                    p.type
                  )}
                  •
                  ${escapeHtml(
                    p.wilaya || ''
                  )}
                </div>

                <p
                  class="muted"
                  style="font-size:12px;margin-top:6px"
                >
                  ${escapeHtml(
                    p.description || ''
                  )}
                </p>

                ${
                  p.url
                    ? `<a
                        href="${escapeHtml(
                          p.url
                        )}"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        زيارة الرابط ↗
                      </a>`
                    : ''
                }

              </div>
              `
          )
          .join('')
      : '<div class="empty">ما كاش ترويجات معتمدة حالياً.</div>';
}

function renderProfile(uid) {
  getDoc(
    doc(
      db,
      'users',
      uid
    )
  ).then(userDoc => {

    const userData =
      userDoc.exists()
        ? userDoc.data()
        : {};

    if ($('#profileName')) {
      $('#profileName').textContent =
        userData.displayName ||
        'مستخدم';
    }

    if ($('#profileDisplayName')) {
      $('#profileDisplayName').textContent =
        userData.displayName ||
        'مستخدم';
    }

    if ($('#profileMeta')) {
      $('#profileMeta').textContent =
        (
          userData.verified
            ? '✓ حساب موثّق • '
            : ''
        ) +
        'عضو منذ ' +
        formatDate(
          userData.createdAt
        );
    }

    if ($('#profileAvatar')) {
      $('#profileAvatar').innerHTML =
        userData.photoURL
          ? `<img
              src="${escapeHtml(
                userData.photoURL
              )}"
              alt=""
            >`
          : '👤';
    }

    const userListings =
      listings.filter(
        l =>
          l.ownerUid ===
          uid
      );

    if ($('#profileStats')) {
      $('#profileStats').innerHTML =
        `
        <div>
          <b>${userListings.length}</b>
          <span>إعلان</span>
        </div>

        <div>
          <b>${userData.ratingCount || 0}</b>
          <span>تقييم</span>
        </div>
        `;
    }

    renderListings(
      userListings,
      '#profileListings'
    );
  });
}

function renderMyListings() {
  const card =
    $('#myListingsCard');

  if (
    !card ||
    !currentUser
  ) {
    if (card) {
      card.hidden = true;
    }

    return;
  }

  card.hidden = false;

  const myListings =
    listings.filter(
      l =>
        l.ownerUid ===
        currentUser.uid
    );

  renderListings(
    myListings,
    '#myListingsGrid'
  );
}

async function submitDriver(e) {
  e.preventDefault();

  if (!requireLogin()) return;

  const f =
    new FormData(e.target);

  const birth =
    new Date(
      f.get('birth')
    );

  const age =
    (
      Date.now() -
      birth.getTime()
    ) /
    (
      365.25 *
      24 *
      3600 *
      1000
    );

  if (
    !Number.isFinite(age) ||
    age < 18
  ) {
    toast(
      'لازم تكون 18 سنة أو أكثر'
    );

    return;
  }

  const item = {
    ownerUid:
      currentUser.uid,

    name:
      String(
        f.get('name') || ''
      ).trim(),

    birthDate:
      String(
        f.get('birth')
      ),

    phone:
      String(
        f.get('phone') || ''
      ).trim(),

    wilaya:
      f.get('wilaya'),

    vehicle:
      f.get('vehicle'),

    vehicleNumber:
      String(
        f.get(
          'vehicleNumber'
        ) || ''
      ).trim(),

    status:
      'pending',

    verified:
      false,

    activityStatus:
      'offline',

    lastSeenAt:
      serverTimestamp(),

    rating: null,

    rides: 0,

    createdAt:
      serverTimestamp(),

    updatedAt:
      serverTimestamp()
  };

  try {

    await addDoc(
      collection(
        db,
        'drivers'
      ),
      item
    );

    e.target.reset();

    toast(
      'تم إرسال طلب المراجعة إلى الإدارة 🛡️'
    );

  } catch (err) {
    console.error(err);

    toast(
      'فشل إرسال طلب الموصّل'
    );
  }
}

function renderDrivers() {
  const el =
    $('#driverGrid');

  if (!el) return;

  el.innerHTML =
    drivers.length
      ? drivers
          .map(d => {

            const st =
              statusMeta(d);

            return `
              <article class="driver">

                <div class="driver-head">

                  <h3>
                    ${escapeHtml(
                      d.name ||
                      'موصّل'
                    )}

                    ${
                      d.verified
                        ? ' ✓'
                        : ''
                    }
                  </h3>

                  <span
                    class="driver-status ${st.s}"
                  >
                    ${st.label}
                  </span>

                </div>

                <div class="meta">
                  📍
                  ${escapeHtml(
                    d.wilaya || ''
                  )}
                </div>

                <div class="meta">
                  🚗
                  ${escapeHtml(
                    d.vehicle || ''
                  )}
                </div>

                ${
                  st.lastSeen
                    ? `
                      <div class="meta">
                        آخر ظهور:
                        ${escapeHtml(
                          st.lastSeen
                        )}
                      </div>
                    `
                    : ''
                }

              </article>
            `;
          })
          .join('')
      : '<div class="empty">لا يوجد موصلون متاحون حالياً.</div>';
}

function renderMyDriver() {
  const el =
    $('#myDriver');

  if (!el) return;

  if (!myDriver) {
    el.innerHTML =
      '<div class="empty">ما عندكش طلب موصل حالياً.</div>';

    return;
  }

  const st =
    statusMeta(myDriver);

  el.innerHTML =
    `
    <div class="admin-item">

      <b>
        ${escapeHtml(
          myDriver.name ||
          'موصل'
        )}
      </b>

      <div class="meta">
        الحالة:
        ${escapeHtml(
          myDriver.status ||
          'pending'
        )}
      </div>

      <div class="meta">
        النشاط:
        ${escapeHtml(
          st.label
        )}
      </div>

    </div>
    `;
}

function renderConversations() {
  const el =
    $('#conversationList');

  if (!el) return;

  el.innerHTML =
    conversations.length
      ? conversations
          .map(
            c =>
              `
              <button
                class="conversation-item"
                data-conversation="${escapeHtml(
                  c.id
                )}"
              >
                <b>
                  ${escapeHtml(
                    c.title ||
                    c.otherName ||
                    'محادثة'
                  )}
                </b>

                <span class="meta">
                  ${escapeHtml(
                    c.lastMessage ||
                    ''
                  )}
                </span>

              </button>
              `
          )
          .join('')
      : '<div class="empty">لا توجد محادثات.</div>';

  $$(
    '[data-conversation]'
  ).forEach(b => {
    b.onclick = () =>
      openConversation(
        b.dataset
          .conversation
      );
  });
}

function renderBlocked() {
  const el =
    $('#blockedList');

  if (!el) return;

  el.innerHTML =
    blocked.length
      ? blocked
          .map(
            b =>
              `
              <div class="admin-item">

                <b>
                  ${escapeHtml(
                    b.targetName ||
                    'حساب'
                  )}
                </b>

                <button
                  class="small-btn"
                  data-unblock="${escapeHtml(
                    b.targetUid
                  )}"
                >
                  إلغاء الحظر
                </button>

              </div>
              `
          )
          .join('')
      : '<div class="empty">لا يوجد حسابات محظورة.</div>';

  $$(
    '[data-unblock]'
  ).forEach(b => {
    b.onclick = () =>
      unblockUser(
        b.dataset.unblock
      );
  });
}

async function unblockUser(uid) {
  if (!requireLogin()) return;

  try {
    await deleteDoc(
      doc(
        db,
        'blocks',
        currentUser.uid +
          '_' +
          uid
      )
    );

    toast(
      'تم إلغاء الحظر.'
    );

  } catch (e) {
    console.error(e);

    toast(
      'تعذر إلغاء الحظر.'
    );
  }
}

async function blockUser(uid) {
  if (
    !requireLogin() ||
    uid === currentUser.uid
  ) {
    return;
  }

  const id =
    currentUser.uid +
    '_' +
    uid;

  try {

    await setDoc(
      doc(
        db,
        'blocks',
        id
      ),
      {
        blockerUid:
          currentUser.uid,

        targetUid:
          uid,

        targetName:
          listings.find(
            x =>
              x.ownerUid === uid
          )?.seller ||
          'حساب',

        createdAt:
          serverTimestamp()
      }
    );

    toast(
      'تم حظر الحساب 🚫'
    );

    closeModal();

  } catch (e) {
    console.error(e);

    toast(
      'تعذر حظر الحساب.'
    );
  }
}

function openReport(type, id) {
  if (!requireLogin()) return;

  if ($('#reportTargetId')) {
    $('#reportTargetId').value =
      id;
  }

  if ($('#reportTargetType')) {
    $('#reportTargetType').value =
      type;
  }

  if ($('#reportModal')) {
    $('#reportModal').hidden =
      false;
  }
}

function closeReport() {
  if ($('#reportModal')) {
    $('#reportModal').hidden =
      true;
  }
}

async function submitReport(e) {
  e.preventDefault();

  if (!requireLogin()) return;

  try {

    await addDoc(
      collection(
        db,
        'reports'
      ),
      {
        reporterUid:
          currentUser.uid,

        targetType:
          $('#reportTargetType')
            ?.value || '',

        targetId:
          $('#reportTargetId')
            ?.value || '',

        reason:
          $('#reportReason')
            ?.value || '',

        details:
          $('#reportDetails')
            ?.value
            .trim() || '',

        status:
          'open',

        createdAt:
          serverTimestamp(),

        updatedAt:
          serverTimestamp()
      }
    );

    toast(
      'تم إرسال البلاغ للإدارة 🚩'
    );

    closeReport();

  } catch (e) {
    console.error(e);

    toast(
      'تعذر إرسال البلاغ.'
    );
  }
}

async function submitPromotion(e) {
  e.preventDefault();

  if (!requireLogin()) return;

  const f =
    new FormData(e.target);

  let imageUrl = '';

  const file =
    $('#promoImageInput');

  if (
    file?.files.length
  ) {
    try {

      imageUrl =
        await uploadImageToCloudinary(
          file.files[0]
        );

    } catch (err) {
      toast(
        err.message
      );

      return;
    }
  }

  const item = {
    ownerUid:
      currentUser.uid,

    name:
      String(
        f.get('name') || ''
      ).trim(),

    type:
      f.get('type'),

    wilaya:
      f.get('wilaya'),

    url:
      String(
        f.get('url') || ''
      ).trim(),

    description:
      String(
        f.get('description') || ''
      ).trim(),

    image:
      imageUrl,

    status:
      'pending',

    createdAt:
      serverTimestamp(),

    updatedAt:
      serverTimestamp()
  };

  try {

    await addDoc(
      collection(
        db,
        'promotions'
      ),
      item
    );

    e.target.reset();

    toast(
      'تم إرسال طلب الترويج للمراجعة 📣'
    );

  } catch (err) {
    console.error(err);

    toast(
      'فشل إرسال الترويج.'
    );
  }
}

async function startConversation(
  ownerUid,
  listingId
) {
  if (!requireLogin()) return;

  if (
    !ownerUid ||
    ownerUid === currentUser.uid
  ) {
    return;
  }

  try {

    const conversationId =
      [currentUser.uid, ownerUid]
        .sort()
        .join('_');

    const ref =
      doc(
        db,
        'conversations',
        conversationId
      );

    const snap =
      await getDoc(ref);

    if (!snap.exists()) {

      await setDoc(
        ref,
        {
          participants: [
            currentUser.uid,
            ownerUid
          ],

          listingId:
            listingId || null,

          lastMessage:
            '',

          updatedAt:
            serverTimestamp(),

          createdAt:
            serverTimestamp()
        }
      );
    }

    openConversation(
      conversationId
    );

  } catch (e) {
    console.error(e);

    toast(
      'تعذر فتح المحادثة.'
    );
  }
}

async function openConversation(id) {
  activeConversation =
    id;

  const modal =
    $('#chatModal');

  if (!modal) return;

  modal.hidden = false;

  renderChatMessages(
    id
  );
}

function closeChat() {
  if ($('#chatModal')) {
    $('#chatModal').hidden =
      true;
  }

  activeConversation =
    null;
}

function renderChatMessages(id) {
  const el =
    $('#chatMessages');

  if (!el) return;

  if (unsub.chat) {
    unsub.chat();
  }

  unsub.chat =
    onSnapshot(
      query(
        collection(
          db,
          'conversations',
          id,
          'messages'
        ),
        limit(100)
      ),

      s => {

        const messages =
          newestFirst(
            snapshotItems(s),
            'createdAt'
          ).reverse();

        el.innerHTML =
          messages
            .map(
              m =>
                `
                <div
                  class="chat-message ${
                    m.senderUid ===
                    currentUser?.uid
                      ? 'mine'
                      : ''
                  }"
                >
                  ${escapeHtml(
                    m.text || ''
                  )}
                </div>
                `
            )
            .join('') ||
          '<div class="empty">ابدأ المحادثة.</div>';

        el.scrollTop =
          el.scrollHeight;
      },

      e =>
        console.error(
          'chat:',
          e
        )
    );
}

async function sendMessage(e) {
  e.preventDefault();

  if (
    !requireLogin() ||
    !activeConversation
  ) {
    return;
  }

  const input =
    $('#chatInput');

  const text =
    input?.value
      .trim() || '';

  if (!text) return;

  try {

    await addDoc(
      collection(
        db,
        'conversations',
        activeConversation,
        'messages'
      ),
      {
        senderUid:
          currentUser.uid,

        text,

        createdAt:
          serverTimestamp()
      }
    );

    await updateDoc(
      doc(
        db,
        'conversations',
        activeConversation
      ),
      {
        lastMessage:
          text,

        updatedAt:
          serverTimestamp()
      }
    );

    input.value = '';

  } catch (err) {
    console.error(err);

    toast(
      'تعذر إرسال الرسالة.'
    );
  }
}

function renderTracking() {
  const el =
    $('#trackingList');

  if (!el) return;

  el.innerHTML =
    deliveryRequests.length
      ? deliveryRequests
          .map(
            r =>
              `
              <div class="admin-item">

                <b>
                  طلب توصيل
                </b>

                <div class="meta">
                  الحالة:
                  ${escapeHtml(
                    r.status ||
                    'pending'
                  )}
                </div>

                <div class="meta">
                  ${escapeHtml(
                    r.wilaya ||
                    ''
                  )}
                </div>

              </div>
              `
          )
          .join('')
      : '<div class="empty">لا توجد طلبات توصيل.</div>';
}

function renderMyDeliveries() {
  const el =
    $('#myDeliveries');

  if (!el) return;

  el.innerHTML =
    deliveryRequests.length
      ? deliveryRequests
          .map(
            r =>
              `
              <div class="admin-item">

                <b>
                  طلب توصيل
                </b>

                <div class="meta">
                  ${escapeHtml(
                    r.status ||
                    'pending'
                  )}
                </div>

              </div>
              `
          )
          .join('')
      : '<div class="empty">لا توجد طلبات توصيل.</div>';
}

function heartbeat() {
  if (!currentUser || !myDriver) {
    return;
  }

  updateDoc(
    doc(
      db,
      'drivers',
      myDriver.id
    ),
    {
      lastSeenAt:
        serverTimestamp(),

      updatedAt:
        serverTimestamp()
    }
  ).catch(() => {});
}

function showAiSuggestions() {
  const title =
    $('#postTitle')?.value
      .trim()
      .toLowerCase() || '';

  const desc =
    $('#postDesc')?.value
      .trim()
      .toLowerCase() || '';

  const text =
    `${title} ${desc}`;

  const match =
    Object.keys(
      AI_CATEGORY_HINTS
    ).find(
      key =>
        text.includes(key)
    );

  const category =
    match
      ? AI_CATEGORY_HINTS[match]
      : '';

  const el =
    $('#aiSuggestion');

  if (!el) return;

  if (category) {
    el.textContent =
      `اقتراح القسم: ${category}`;
  } else {
    el.textContent = '';
  }
}

function initImageUpload() {
  const input =
    $('#imageInput');

  if (!input) return;

  input.addEventListener(
    'change',
    async () => {

      const files =
        [...input.files];

      for (
        const file of files.slice(
          0,
          5
        )
      ) {

        try {

          const url =
            await uploadImageToCloudinary(
              file
            );

          currentImages.push(
            url
          );

        } catch (e) {
          toast(
            e.message
          );
        }
      }

      renderImagePreview();
    }
  );
}

function renderImagePreview() {
  const el =
    $('#imagePreviewGrid');

  if (!el) return;

  el.innerHTML =
    currentImages
      .map(
        (url, i) =>
          `
          <div class="image-preview">

            <img
              src="${escapeHtml(
                cloudinaryUrl(
                  url,
                  200,
                  200
                )
              )}"
              alt=""
            >

            <button
              type="button"
              data-remove-image="${i}"
            >
              ×
            </button>

          </div>
          `
      )
      .join('');

  $$(
    '[data-remove-image]'
  ).forEach(b => {
    b.onclick = () => {

      currentImages.splice(
        Number(
          b.dataset
            .removeImage
        ),
        1
      );

      renderImagePreview();
    };
  });
}

function updateAccountUI() {

  const logged =
    !!currentUser;

  if ($('#firebaseLogin')) {
    $('#firebaseLogin').hidden =
      logged;
  }

  if ($('#firebaseLogout')) {
    $('#firebaseLogout').hidden =
      !logged;
  }

  if ($('#accountName')) {
    $('#accountName').textContent =
      currentProfile?.displayName ||
      currentUser?.displayName ||
      'زائر';
  }

  if ($('#accountAvatar')) {
    $('#accountAvatar').innerHTML =
      currentProfile?.photoURL
        ? `<img
            src="${escapeHtml(
              currentProfile.photoURL
            )}"
            alt=""
          >`
        : '👤';
  }

  if ($('#adminNav')) {
    $('#adminNav').hidden =
      !isAdmin;
  }
}

async function submitRating(e) {
  e.preventDefault();

  if (!requireLogin()) return;

  const listingId =
    $('#ratingListingId')
      ?.value;

  const value =
    Number(
      $('#ratingValue')
        ?.value || 0
    );

  if (
    !listingId ||
    value < 1 ||
    value > 5
  ) {
    toast(
      'اختر تقييمًا من 1 إلى 5.'
    );

    return;
  }

  try {

    await addDoc(
      collection(
        db,
        'ratings'
      ),
      {
        listingId,

        userUid:
          currentUser.uid,

        value,

        createdAt:
          serverTimestamp()
      }
    );

    toast(
      'تم إرسال التقييم ⭐'
    );

    closeRating();

  } catch (e) {
    console.error(e);

    toast(
      'تعذر إرسال التقييم.'
    );
  }
}

function closeRating() {
  if ($('#ratingModal')) {
    $('#ratingModal').hidden =
      true;
  }
}

$$('[data-view]').forEach(
  b =>
    b.addEventListener(
      'click',
      () =>
        go(
          b.dataset.view
        )
    )
);

$('#globalSearch')?.addEventListener(
  'input',
  () => {
    const has =
      $('#globalSearch')
        .value.trim();

    if ($('#clearSearch')) {
      $('#clearSearch').hidden =
        !has;
    }

    go('search');
    applyFilters();
  }
);

$('#clearSearch')?.addEventListener(
  'click',
  () => {
    $('#globalSearch').value =
      '';

    $('#clearSearch').hidden =
      true;

    applyFilters();
  }
);

$('#heroSearchBtn')?.addEventListener(
  'click',
  () => {

    const q =
      $('#heroSearch')
        .value.trim();

    $('#globalSearch').value =
      q;

    $('#clearSearch').hidden =
      !q;

    go('search');

    applyFilters();
  }
);

$('#heroSearch')?.addEventListener(
  'keydown',
  e => {
    if (e.key === 'Enter') {
      $('#heroSearchBtn')?.click();
    }
  }
);

$$(
  '.quick-links button'
).forEach(
  b =>
    b.onclick = () => {
      $('#heroSearch').value =
        b.dataset.query;

      $('#heroSearchBtn')?.click();
    }
);

[
  '#filterCategory',
  '#filterWilaya',
  '#filterCondition',
  '#minPrice',
  '#maxPrice',
  '#filterDelivery',
  '#sortResults'
].forEach(id => {
  $(id)?.addEventListener(
    'input',
    applyFilters
  );
});

$('#filterCity')?.addEventListener(
  'input',
  applyFilters
);

$('#filterVerified')?.addEventListener(
  'change',
  applyFilters
);

$('#resetFilters')?.addEventListener(
  'click',
  () => {

    if ($('#filterCategory')) {
      $('#filterCategory').value =
        '';
    }

    if ($('#filterWilaya')) {
      $('#filterWilaya').value =
        '';
    }

    if ($('#filterCondition')) {
      $('#filterCondition').value =
        '';
    }

    if ($('#minPrice')) {
      $('#minPrice').value =
        '';
    }

    if ($('#maxPrice')) {
      $('#maxPrice').value =
        '';
    }

    if ($('#filterDelivery')) {
      $('#filterDelivery').checked =
        false;
    }

    if ($('#filterCity')) {
      $('#filterCity').value =
        '';
    }

    if ($('#filterVerified')) {
      $('#filterVerified').checked =
        false;
    }

    applyFilters();
  }
);

$('#postForm')?.addEventListener(
  'submit',
  submitListing
);

$('#driverForm')?.addEventListener(
  'submit',
  submitDriver
);

$('#chatForm')?.addEventListener(
  'submit',
  sendMessage
);

$('#reportForm')?.addEventListener(
  'submit',
  submitReport
);

$('#ratingForm')?.addEventListener(
  'submit',
  submitRating
);

$('#promoForm')?.addEventListener(
  'submit',
  submitPromotion
);

$('#firebaseLogin')?.addEventListener(
  'click',
  loginGoogle
);

$('#firebaseLogout')?.addEventListener(
  'click',
  logout
);

$$(
  '[data-close-modal]'
).forEach(
  x =>
    x.addEventListener(
      'click',
      closeModal
    )
);

$$(
  '[data-close-chat]'
).forEach(
  x =>
    x.addEventListener(
      'click',
      closeChat
    )
);

$$(
  '[data-close-report]'
).forEach(
  x =>
    x.addEventListener(
      'click',
      closeReport
    )
);

$$(
  '[data-close-rating]'
).forEach(
  x =>
    x.addEventListener(
      'click',
      closeRating
    )
);

document.addEventListener(
  'keydown',
  e => {
    if (e.key === 'Escape') {
      closeModal();
      closeChat();
      closeReport();
      closeRating();
    }
  }
);

$$(
  '#starRating button'
).forEach(
  btn => {
    btn.onclick = () => {

      const val =
        btn.dataset.star;

      if ($('#ratingValue')) {
        $('#ratingValue').value =
          val;
      }

      $$('#starRating button')
        .forEach(
          b =>
            b.classList.toggle(
              'active',
              Number(
                b.dataset.star
              ) <= Number(val)
            )
        );
    };
  }
);

$('#postTitle')?.addEventListener(
  'input',
  showAiSuggestions
);

$('#postDesc')?.addEventListener(
  'input',
  showAiSuggestions
);

categoryCards(
  '#categoryGrid'
);

categoryCards(
  '#allCategoryGrid'
);

selectOptions();

initImageUpload();

initDarkMode();

setFirebaseState(
  'Firebase: جاري التحقق...',
  true
);

subscribeData();

setInterval(
  heartbeat,
  60000
);

document.addEventListener(
  'visibilitychange',
  () => {
    if (!document.hidden) {
      heartbeat();
    }
  }
);

onAuthStateChanged(
  auth,
  async user => {

    currentUser =
      user;

    if (user) {

      try {

        currentProfile =
          await ensureUserProfile(
            user
          );

        isAdmin =
          currentProfile?.role ===
          'admin';

        favorites =
          Array.isArray(
            currentProfile
              ?.favoriteIds
          )
            ? currentProfile.favoriteIds
            : [];

        setFirebaseState(
          'Firebase + Google Auth: متصل ✅',
          true
        );

        subscribeMine();

      } catch (e) {

        console.error(e);

        currentProfile =
          null;

        isAdmin =
          false;

        favorites =
          [];

        setFirebaseState(
          'Firebase: تحقق من Rules',
          false
        );
      }

    } else {

      currentProfile =
        null;

      isAdmin =
        false;

      favorites =
        [];

      myDriver =
        null;

      conversations =
        [];

      blocked =
        [];

      deliveryRequests =
        [];

      adminDriverList =
        [];

      Object.values(unsub)
        .forEach(
          fn =>
            typeof fn ===
              'function' &&
            fn()
        );

      unsub = {};

      setFirebaseState(
        'Firebase: متصل، لم يتم تسجيل الدخول.',
        true
      );
    }

    updateAccountUI();

    renderAll();

    renderConversations();

    renderBlocked();

    renderMyDriver();

    renderMyListings();

    renderMyDeliveries();

    if (isAdmin) {
      renderAdmin();
    }
  }
);

window.addEventListener(
  'load',
  handleUrlParams
);

if (
  'serviceWorker' in
  navigator
) {
  navigator.serviceWorker
    .register('sw.js')
    .catch(() => {});
}

function renderAll() {

  renderListings(
    newestFirst(
      listings
    ).slice(0, 8),
    '#homeListings'
  );

  renderFavorites();

  renderDrivers();

  if ($('#favBadge')) {
    $('#favBadge').textContent =
      favorites.length;

    $('#favBadge').hidden =
      !favorites.length;
  }

  if ($('#statListings')) {
    $('#statListings').textContent =
      listings.length;
  }

  if ($('#statDrivers')) {
    $('#statDrivers').textContent =
      drivers.length;
  }
}
