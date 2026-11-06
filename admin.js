import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app-check.js';
import { firebaseConfig, appCheckSiteKey } from './firebase-config.js';

// ⚠️ فقط هذا الإيميل يقدر يدخل للوحة الإدارة. بدّلو من هنا إذا حبيت تبدّل حساب الأدمن،
// وبدّل نفس القيمة فـ firestore.rules (primaryAdminEmail) باش يبقاو متوافقين.
const ADMIN_EMAIL = '111aez333@gmail.com';

const firebaseApp = initializeApp(firebaseConfig);

// App Check: يمنع استعمال الـAPI من خارج موقعك. يخدم غير إذا فعّلتو فـ Firebase Console (App Check → Enforce).
// فـ localhost نستعملو debug token (يطلع فـ console، سجّلو فـ Firebase Console → App Check → Manage debug tokens).
try {
  if (['localhost', '127.0.0.1'].includes(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  if (appCheckSiteKey && !String(appCheckSiteKey).startsWith('YOUR_')) {
    initializeAppCheck(firebaseApp, { provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  }
} catch (e) { console.warn('App Check:', e); }
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();

let listings = [], drivers = [], deliveryRequests = [], reports = [], allUsers = [], promotions = [];
let unsub = {};
let currentUser = null;
let listingsSearch = '', usersSearch = '', deliverySearch = '', deliveryStatusFilter = '';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
function escapeHtml(s = '') { return String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function toast(t) { const x = $('#toast'); if (!x) return; x.textContent = t; x.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => x.classList.remove('show'), 3000); }
function formatPrice(v) { return Number(v || 0).toLocaleString('fr-DZ') + ' دج'; }
function safeUrl(u) { try { const x = new URL(String(u || '').trim()); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; } catch { return ''; } }
function showLoading(on) { const x = $('#loadingOverlay'); if (x) x.hidden = !on; }
function fmtDate(ts) { try { const d = ts?.toDate ? ts.toDate() : (ts?.seconds ? new Date(ts.seconds * 1000) : null); return d ? d.toLocaleString('ar-DZ') : '—'; } catch { return '—'; } }
function mapLink(loc) { return loc && typeof loc.lat === 'number' ? `<a href="https://www.google.com/maps?q=${loc.lat},${loc.lng}" target="_blank" rel="noopener">📍 فتح الموقع فـ Google Maps</a>` : '<span class="muted">لا موقع مسجّل</span>'; }

const DELIVERY_STATUS_LABEL = {
  pending: '⏳ بانتظار الموافقة', pending_review: '⏳ بانتظار الموافقة', approved: '✅ تمت الموافقة، بانتظار موصّل',
  assigned: '🚚 تم تعيين موصّل', picked_up: '📦 تم الاستلام', delivering: '🚗 في الطريق',
  completed: '✅ تم التسليم', rejected: '❌ مرفوض', cancelled: '✖️ ملغى'
};

function showGate(status) { $('#gateView').hidden = false; $('#deniedView').hidden = true; $('#dashboardView').hidden = true; if (status) $('#gateStatus').textContent = status; }
function showDenied() { $('#gateView').hidden = true; $('#deniedView').hidden = false; $('#dashboardView').hidden = true; }
function showDashboard() { $('#gateView').hidden = true; $('#deniedView').hidden = true; $('#dashboardView').hidden = false; }

// FIX: signInWithRedirect كان يدير "تسجيل دخول" كامل بجولة صفحة لـGoogle ورجوع،
// وفهاذ الإعداد (127.0.0.1/localhost عبر Live Server) الجلسة ما كانت تبقاش محفوظة
// بعد الرجوع — تبان تسجل الدخول للحظة وبعدها ترجع لبوابة الدخول (loop).
// signInWithPopup يبقى فنفس الصفحة (بلا جولة كاملة) وهو اللي يخدم بنجاح فـapp.js
// لنفس الحساب، فبدّلناه هنا زيد باش يبقاو الاثنين متوافقين.
$('#adminLoginBtn').onclick = async () => {
  try { await signInWithPopup(auth, googleProvider); }
  catch (e) {
    if (e.code !== 'auth/popup-closed-by-user') toast('تعذر تسجيل الدخول: ' + e.code);
  }
};
$('#adminLogoutBtn').onclick = () => signOut(auth);
$('#dashLogoutBtn').onclick = () => signOut(auth);
$('#adminListingsSearch')?.addEventListener('input', e => { listingsSearch = e.target.value; renderAll(); });
$('#adminUsersSearch')?.addEventListener('input', e => { usersSearch = e.target.value; renderAll(); });

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) { Object.values(unsub).forEach(u => u && u()); unsub = {}; showGate('لم تسجل الدخول بعد.'); return; }
  if (user.email !== ADMIN_EMAIL || !user.emailVerified) {
    showDenied();
    return;
  }
  try {
    // يثبّت صلاحية الأدمن في Firestore تلقائياً لهذا الحساب فقط، باش تخدم قواعد الأمان الجانبية أيضاً
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { uid: user.uid, displayName: user.displayName || 'الإدارة', email: user.email || '', photoURL: user.photoURL || '', role: 'admin', verified: true, banned: false, createdAt: serverTimestamp() });
    } else if (snap.data().role !== 'admin') {
      await updateDoc(ref, { role: 'admin', updatedAt: serverTimestamp() });
    }
    showDashboard();
    subscribeAll();
  } catch (e) { console.error(e); toast('صار خطأ أثناء التحقق من الحساب.'); }
});

function subscribeAll() {
  if (unsub.listings) unsub.listings();
  unsub.listings = onSnapshot(collection(db, 'listings'), s => { listings = s.docs.map(d => ({ id: d.id, ...d.data() })); renderAll(); }, e => console.error(e));
  if (unsub.drivers) unsub.drivers();
  unsub.drivers = onSnapshot(collection(db, 'drivers'), s => { drivers = s.docs.map(d => ({ id: d.id, ...d.data() })); renderAll(); }, e => console.error(e));
  if (unsub.deliveryRequests) unsub.deliveryRequests();
  unsub.deliveryRequests = onSnapshot(collection(db, 'deliveryRequests'), s => { deliveryRequests = s.docs.map(d => ({ id: d.id, ...d.data() })); renderAll(); }, e => console.error(e));
  if (unsub.reports) unsub.reports();
  unsub.reports = onSnapshot(collection(db, 'reports'), s => { reports = s.docs.map(d => ({ id: d.id, ...d.data() })); renderAll(); }, e => console.error(e));
  if (unsub.users) unsub.users();
  unsub.users = onSnapshot(collection(db, 'users'), s => { allUsers = s.docs.map(d => ({ uid: d.id, ...d.data() })); renderAll(); }, e => console.error(e));
  if (unsub.promotions) unsub.promotions();
  unsub.promotions = onSnapshot(collection(db, 'promotions'), s => { promotions = s.docs.map(d => ({ id: d.id, ...d.data() })); renderAll(); }, e => console.error(e));
}

function renderAll() {
  $('#statListings').textContent = listings.length;
  $('#statDrivers').textContent = drivers.length;
  $('#statReports').textContent = reports.filter(r => r.status === 'open').length;
  $('#statDeliveryRequests').textContent = deliveryRequests.length;
  $('#statUsers').textContent = allUsers.length;
  $('#statPromotions').textContent = promotions.length;
  $('#statPendingReview').textContent = deliveryRequests.filter(r => ['pending', 'pending_review'].includes(r.status)).length + drivers.filter(d => d.status === 'pending').length;
  $('#statFlagged').textContent = listings.filter(x => x.flagged).length;

  const q1 = listingsSearch.trim().toLowerCase();
  const filteredListings = q1 ? listings.filter(x => `${x.title || ''} ${x.status || ''} ${x.category || ''}`.toLowerCase().includes(q1)) : listings;
  $('#adminListings').innerHTML = filteredListings.slice(0, 60).map(x => `<div class="admin-item"><b>${escapeHtml(x.title)}</b><div class="meta">${formatPrice(x.price)} •${escapeHtml(x.status || '')}${x.aiScore != null ? ` • 🤖 ${x.aiScore}` : ''}${x.flagged ? ' • ⚠️' : ''}</div>
    <div class="admin-item-actions">
    ${x.status === 'published' ? `<button class="small-btn" data-unpublish-listing="${x.id}">إخفاء</button>` : `<button class="small-btn success" data-publish-listing="${x.id}">نشر</button>`}
    <button class="small-btn danger" data-delete-listing="${x.id}">حذف</button>
    </div></div>`).join('') || `<div class="empty small-empty">${q1 ? 'ما لقيناش إعلانات مطابقة.' : 'لا إعلانات.'}</div>`;
  $$('[data-unpublish-listing]').forEach(b => b.onclick = () => moderateListing(b.dataset.unpublishListing, 'hidden'));
  $$('[data-publish-listing]').forEach(b => b.onclick = () => moderateListing(b.dataset.publishListing, 'published'));
  $$('[data-delete-listing]').forEach(b => b.onclick = () => removeDoc('listings', b.dataset.deleteListing, 'الإعلان'));

  // ---------- الموصلون (تفاصيل كاملة + وثائق) ----------
  $('#adminDrivers').innerHTML = drivers.length ? drivers.map(d => {
    return `<div class="admin-detail">
    <h3>🚚 ${escapeHtml(d.name || 'موصل')} ${d.verified ? '<span class="verified">✓</span>' : ''}</h3>
    <div class="row">📞 <a href="tel:${escapeHtml(d.phone || '')}">${escapeHtml(d.phone || '—')}</a> • 📍 ${escapeHtml(d.wilaya || '')}</div>
    <div class="row">🚗 ${escapeHtml(d.vehicle || '')} ${escapeHtml(d.vehicleNumber || '')} • الحالة: <b>${escapeHtml(d.status || '')}</b> • ${escapeHtml(d.activityStatus || '')}</div>
    ${safeUrl(d.facebook) ? `<div class="row">🔵 <a href="${escapeHtml(safeUrl(d.facebook))}" target="_blank" rel="noopener noreferrer">فايسبوك</a></div>` : ''}
    <div class="row">🕒 سُجّل: ${fmtDate(d.createdAt)}</div>
    <div class="row muted">UID: ${escapeHtml(d.ownerUid || '')}</div>
    <div class="admin-item-actions">
      ${d.status !== 'approved' ? `<button class="small-btn success" data-approve-driver="${d.id}">قبول</button>` : ''}
      ${d.status !== 'rejected' ? `<button class="small-btn danger" data-reject-driver="${d.id}">${d.status === 'approved' ? 'إيقاف' : 'رفض'}</button>` : ''}
      <button class="small-btn danger" data-delete-driver="${d.id}">🗑️ حذف</button>
    </div></div>`;
  }).join('') : '<div class="empty small-empty">لا توجد طلبات.</div>';
  $$('[data-approve-driver]').forEach(b => b.onclick = () => approveDriver(b.dataset.approveDriver));
  $$('[data-reject-driver]').forEach(b => b.onclick = () => driverAction(b.dataset.rejectDriver, 'rejected', false));
  $$('[data-delete-driver]').forEach(b => b.onclick = () => removeDoc('drivers', b.dataset.deleteDriver, 'الموصل'));

  // ---------- طلبات التوصيل ----------
  const approvedDrivers = drivers.filter(d => d.status === 'approved' && d.verified);
  const dq = deliverySearch.trim().toLowerCase();
  const sortedReqs = [...deliveryRequests].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  const filteredReqs = sortedReqs.filter(r =>
    (!deliveryStatusFilter || r.status === deliveryStatusFilter) &&
    (!dq || `${r.buyerName || ''} ${r.phone || ''} ${r.wilaya || ''} ${r.city || ''} ${r.address || ''} ${r.listingTitle || ''} ${r.driverName || ''}`.toLowerCase().includes(dq)));
  $('#adminDeliveryRequests').innerHTML = filteredReqs.length ? filteredReqs.map(r => {
    const drv = r.driverId ? drivers.find(x => x.id === r.driverId) : null;
    return `<div class="admin-detail">
    <h3>📦 ${escapeHtml(r.listingTitle || 'طلب توصيل')}</h3>
    <span class="tracking-status status-pending">${DELIVERY_STATUS_LABEL[r.status] || escapeHtml(r.status || '')}</span>
    <div class="row muted">🕒 ${fmtDate(r.createdAt)} • آخر تحديث: ${fmtDate(r.updatedAt)}</div>
    <div class="sec">👤 المشتري</div>
    <div class="row">${escapeHtml(r.buyerName || '')} • 📞 <a href="tel:${escapeHtml(r.phone || '')}">${escapeHtml(r.phone || '')}</a></div>
    <div class="row">📍 ${escapeHtml(r.wilaya || '')} - ${escapeHtml(r.city || '')} • ${escapeHtml(r.address || '')}</div>
    <div class="row">${mapLink(r.location)}</div>
    <div class="row muted">UID المشتري: ${escapeHtml(r.buyerUid || '')} • UID البائع: ${escapeHtml(r.sellerUid || '')}</div>
    <div class="row"><a href="index.html?view=listing&id=${encodeURIComponent(r.listingId || '')}" target="_blank" rel="noopener">🔗 فتح الإعلان</a></div>
    ${r.driverId ? `<div class="sec">🚚 الموصّل المعيّن</div>
    <div class="row">${escapeHtml(r.driverName || drv?.name || '')} • 📞 <a href="tel:${escapeHtml(r.driverPhone || drv?.phone || '')}">${escapeHtml(r.driverPhone || drv?.phone || '')}</a> • ${escapeHtml(drv?.vehicle || '')} ${escapeHtml(drv?.vehicleNumber || '')}</div>` : ''}
    <div class="admin-item-actions">
      ${['pending', 'pending_review'].includes(r.status) ? `<button class="small-btn success" data-dr-approve="${r.id}">✅ قبول الطلب</button><button class="small-btn danger" data-dr-reject="${r.id}">❌ رفض</button>` : ''}
      ${['approved', 'assigned'].includes(r.status) ? `<select class="small-select" data-dr-assign="${r.id}"><option value="">${r.driverId ? 'تغيير الموصّل...' : 'اختار موصّل...'}</option>${approvedDrivers.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)} (${escapeHtml(d.wilaya)})</option>`).join('')}</select>` : ''}
      ${!['completed', 'cancelled', 'rejected'].includes(r.status) ? `<button class="small-btn" data-dr-complete="${r.id}">✔️ تم التسليم</button><button class="small-btn" data-dr-cancel="${r.id}">✖️ إلغاء</button>` : ''}
      <button class="small-btn danger" data-dr-delete="${r.id}">🗑️ حذف الطلب</button>
    </div></div>`;
  }).join('') : '<div class="empty small-empty">ما كاش طلبات توصيل مطابقة.</div>';
  $$('[data-dr-approve]').forEach(b => b.onclick = () => updateDeliveryStatus(b.dataset.drApprove, 'approved'));
  $$('[data-dr-reject]').forEach(b => b.onclick = () => updateDeliveryStatus(b.dataset.drReject, 'rejected'));
  $$('[data-dr-complete]').forEach(b => b.onclick = () => updateDeliveryStatus(b.dataset.drComplete, 'completed'));
  $$('[data-dr-cancel]').forEach(b => b.onclick = () => updateDeliveryStatus(b.dataset.drCancel, 'cancelled'));
  $$('[data-dr-delete]').forEach(b => b.onclick = () => removeDoc('deliveryRequests', b.dataset.drDelete, 'طلب التوصيل'));
  $$('[data-dr-assign]').forEach(sel => sel.onchange = () => { if (sel.value) assignDriver(sel.dataset.drAssign, sel.value); });

  $('#adminReports').innerHTML = reports.length ? reports.map(r => `<div class="admin-item"><b>${escapeHtml(r.reason || 'بلاغ')}</b><div class="meta">${escapeHtml(r.targetType || '')} • من: ${escapeHtml(r.reporterName || '')}</div>${r.details ? `<div class="meta">${escapeHtml(r.details)}</div>` : ''}<span class="tracking-status status-pending">${r.status === 'open' ? '⏳ مفتوح' : '✅ تمت المعالجة'}</span>
    ${r.status === 'open' ? `<div class="admin-item-actions"><button class="small-btn success" data-resolve-report="${r.id}">وسمّه كمُعالج</button></div>` : ''}
    </div>`).join('') : '<div class="empty small-empty">لا بلاغات.</div>';
  $$('[data-resolve-report]').forEach(b => b.onclick = () => resolveReport(b.dataset.resolveReport));

  // Users
  const q2 = usersSearch.trim().toLowerCase();
  const filteredUsers = q2 ? allUsers.filter(u => `${u.displayName || ''} ${u.email || ''}`.toLowerCase().includes(q2)) : allUsers;
  $('#adminUsers').innerHTML = filteredUsers.length ? filteredUsers.slice(0, 60).map(u => `<div class="admin-item">
    <b>${escapeHtml(u.displayName || 'مستخدم')}</b>
    <div class="meta">${escapeHtml(u.email || '')}${u.role === 'admin' ? '• 🛡️ أدمن' : ''}${u.verified ? ' • ✓ موثّق' : ''}${u.banned ? ' • 🚫 موقوف' : ''}</div>
    <div class="admin-item-actions">
      ${u.role !== 'admin' ? `
        <button class="small-btn" data-toggle-verify="${u.uid}">${u.verified ? 'إلغاء التوثيق' : 'توثيق'}</button>
        <button class="small-btn danger" data-toggle-ban="${u.uid}">${u.banned ? 'رفع الإيقاف' : 'إيقاف'}</button>
        <button class="small-btn danger" data-ban-hide="${u.uid}">🚫 إيقاف + إخفاء إعلاناته</button>
      ` : '<span class="meta">حساب الإدارة</span>'}
    </div></div>`).join('') : `<div class="empty small-empty">${q2 ? 'ما لقيناش مستخدمين مطابقين.' : 'لا مستخدمين.'}</div>`;
  $$('[data-toggle-verify]').forEach(b => b.onclick = () => toggleUserFlag(b.dataset.toggleVerify, 'verified'));
  $$('[data-toggle-ban]').forEach(b => b.onclick = () => toggleUserFlag(b.dataset.toggleBan, 'banned'));
  $$('[data-ban-hide]').forEach(b => b.onclick = () => banAndHide(b.dataset.banHide));

  // Promotions
  $('#adminPromotions').innerHTML = promotions.length ? promotions.map(p => `<div class="admin-item">
    <b>${escapeHtml(p.name || 'ترويج')}</b>
    <div class="meta">${escapeHtml(p.type || '')} •${escapeHtml(p.status || '')}</div>
    <div class="admin-item-actions">
      ${p.status !== 'approved' ? `<button class="small-btn success" data-approve-promo="${p.id}">قبول</button>` : ''}
      ${p.status !== 'rejected' ? `<button class="small-btn danger" data-reject-promo="${p.id}">رفض</button>` : ''}
    </div></div>`).join('') : '<div class="empty small-empty">لا ترويجات.</div>';
  $$('[data-approve-promo]').forEach(b => b.onclick = () => moderatePromotion(b.dataset.approvePromo, 'approved'));
  $$('[data-reject-promo]').forEach(b => b.onclick = () => moderatePromotion(b.dataset.rejectPromo, 'rejected'));

  // AI Alerts — مراجعة لاحقة للإعلانات المنشورة
  const flagged = listings.filter(x => x.flagged).sort((a, b) => (b.aiScore || 0) - (a.aiScore || 0));
  $('#aiAdminAlerts').innerHTML = flagged.length ? flagged.slice(0, 40).map(x => `<div class="admin-item">
    <b>⚠️ ${escapeHtml(x.title)}</b>
    <div class="meta">🤖 ${x.aiScore ?? '—'}/100 • ${escapeHtml(x.status || '')} • ${escapeHtml(x.flagReason || 'محتوى مشبوه')}</div>
    <div class="admin-item-actions">
      ${x.status === 'published' ? `<button class="small-btn" data-ai-hide="${x.id}">إخفاء</button>` : ''}
      <button class="small-btn success" data-ai-ok="${x.id}">✓ سليم</button>
      <button class="small-btn danger" data-ai-del="${x.id}">حذف</button>
    </div></div>`).join('') : '<div class="empty small-empty">ما كاش إعلانات مشبوهة 👍</div>';
  $$('[data-ai-hide]').forEach(b => b.onclick = () => moderateListing(b.dataset.aiHide, 'hidden'));
  $$('[data-ai-ok]').forEach(b => b.onclick = () => dismissFlag(b.dataset.aiOk));
  $$('[data-ai-del]').forEach(b => b.onclick = () => removeDoc('listings', b.dataset.aiDel, 'الإعلان'));
}

async function dismissFlag(id) {
  showLoading(true);
  try { await updateDoc(doc(db, 'listings', id), { flagged: false, updatedAt: serverTimestamp() }); toast('تم اعتماد الإعلان ✅'); }
  catch (e) { toast('تعذر التحديث'); }
  finally { showLoading(false); }
}

async function moderateListing(id, status) {
  showLoading(true);
  try {
    await updateDoc(doc(db, 'listings', id), { status, updatedAt: serverTimestamp() });
    toast(status === 'published' ? 'تم نشر الإعلان ✅' : status === 'hidden' ? 'تم إخفاء الإعلان' : 'تم رفض الإعلان');
  } catch (e) { toast('تعذر تحديث الإعلان'); }
  finally { showLoading(false); }
}

async function removeDoc(col, id, label) {
  if (!confirm(`متأكد من حذف ${label}؟`)) return;
  showLoading(true);
  try {
    await deleteDoc(doc(db, col, id));
    toast('تم الحذف ✅');
  } catch (e) { toast('تعذر الحذف'); }
  finally { showLoading(false); }
}

async function driverAction(id, status, verified) {
  showLoading(true);
  try {
    await updateDoc(doc(db, 'drivers', id), { status, verified, updatedAt: serverTimestamp() });
    toast(status === 'approved' ? 'تم قبول الموصل ✅' : 'تم إيقاف الموصل.');
  } catch (e) { toast('تعذر تحديث الموصل.'); }
  finally { showLoading(false); }
}

async function approveDriver(id) {
  if (!confirm('قبول هذا الموصّل؟ راجع اسمه وهاتفه ومركبته قبل الموافقة.')) return;
  return driverAction(id, 'approved', true);
}

async function assignDriver(reqId, driverId) {
  showLoading(true);
  try {
    const d = drivers.find(x => x.id === driverId);
    if (!d || !d.ownerUid) { toast('بيانات الموصل ناقصة'); return; }
    // ننسخو الاسم والهاتف والفايسبوك للطلب باش يشوفهم المشتري
    await updateDoc(doc(db, 'deliveryRequests', reqId), {
      driverId, driverUid: d.ownerUid, driverName: d.name || '', driverPhone: d.phone || '', driverFacebook: d.facebook || '',
      status: 'assigned', updatedAt: serverTimestamp()
    });
    toast('تم تعيين الموصّل 🚚');
  } catch (e) { toast('تعذر تعيين الموصّل'); }
  finally { showLoading(false); }
}

async function updateDeliveryStatus(id, status) {
  showLoading(true);
  try {
    await updateDoc(doc(db, 'deliveryRequests', id), { status, updatedAt: serverTimestamp() });
    toast('تم تحديث الحالة ✅');
  } catch (e) { toast('تعذر التحديث'); }
  finally { showLoading(false); }
}

async function resolveReport(id) {
  showLoading(true);
  try {
    await updateDoc(doc(db, 'reports', id), { status: 'resolved', updatedAt: serverTimestamp() });
    toast('تم وسم البلاغ كمُعالج ✅');
  } catch (e) { toast('تعذر تحديث البلاغ'); }
  finally { showLoading(false); }
}

async function toggleUserFlag(uid, field) {
  const u = allUsers.find(x => x.uid === uid);
  if (!u) return;
  showLoading(true);
  try {
    const next = !u[field];
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', uid), { [field]: next, updatedAt: serverTimestamp() });
    // شارة "موثّق" فالإعلانات القديمة لازم تتبدّل معاه (الحد 450 إعلان فـ batch واحد)
    if (field === 'verified') listings.filter(l => l.ownerUid === uid).slice(0, 450).forEach(l => batch.update(doc(db, 'listings', l.id), { sellerVerified: next }));
    await batch.commit();
    toast('تم التحديث ✅');
  } catch (e) { toast('تعذر التحديث'); }
  finally { showLoading(false); }
}

async function moderatePromotion(id, status) {
  showLoading(true);
  try {
    await updateDoc(doc(db, 'promotions', id), { status, updatedAt: serverTimestamp() });
    toast(status === 'approved' ? 'تم قبول الترويج ✅' : 'تم رفض الترويج');
  } catch (e) { toast('تعذر تحديث الترويج'); }
  finally { showLoading(false); }
}

// ---------- أدوات ضد السبام ----------
async function banAndHide(uid) {
  const mine = listings.filter(l => l.ownerUid === uid);
  if (!confirm(`إيقاف هذا المستخدم وإخفاء ${mine.length} إعلان من إعلاناته؟`)) return;
  showLoading(true);
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', uid), { banned: true, updatedAt: serverTimestamp() });
    mine.slice(0, 450).forEach(l => batch.update(doc(db, 'listings', l.id), { status: 'hidden', updatedAt: serverTimestamp() }));
    await batch.commit();
    toast('تم إيقاف المستخدم وإخفاء إعلاناته ✅');
  } catch (e) { console.error(e); toast('تعذر التنفيذ'); }
  finally { showLoading(false); }
}

// ---------- فهرسة الإعلانات القديمة (keywords) باش تخدم فيها الكلمات فـ البحث ----------
function normalizeWord(w) {
  let s = String(w || '').toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  if (s.length > 3 && s.startsWith('ال')) s = s.slice(2);
  return s;
}
function buildKeywords({ title, category, wilaya, city }) {
  const out = [];
  `${title || ''} ${category || ''} ${wilaya || ''} ${city || ''}`.split(/[^\p{L}\p{N}]+/u).forEach(w => { const n = normalizeWord(w); if (n.length >= 2 && !out.includes(n)) out.push(n); });
  return out.slice(0, 24);
}
$('#reindexBtn')?.addEventListener('click', async () => {
  const todo = listings.filter(l => !Array.isArray(l.keywords));
  if (!todo.length) { toast('كل الإعلانات مفهرسة ✅'); return; }
  if (!confirm(`فهرسة ${todo.length} إعلان؟`)) return;
  showLoading(true);
  try {
    for (let i = 0; i < todo.length; i += 400) {
      const b = writeBatch(db);
      todo.slice(i, i + 400).forEach(l => b.update(doc(db, 'listings', l.id), { keywords: buildKeywords(l) }));
      await b.commit();
    }
    toast('تمت الفهرسة ✅');
  } catch (e) { console.error(e); toast('تعذرت الفهرسة'); }
  finally { showLoading(false); }
});

showGate('جاري التحقق...');
// ---------- فلاتر ----------
$('#adminDeliverySearch')?.addEventListener('input', e => { deliverySearch = e.target.value; renderAll(); });
$('#adminDeliveryStatus')?.addEventListener('change', e => { deliveryStatusFilter = e.target.value; renderAll(); });
