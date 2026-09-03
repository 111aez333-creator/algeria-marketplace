import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

// ⚠️ فقط هذا الإيميل يقدر يدخل للوحة الإدارة. بدّله من هنا إذا حبيت تبدّل حساب الأدمن.
const ADMIN_EMAIL = '111aez333@gmail.com';

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();

let listings=[], drivers=[], deliveryRequests=[], reports=[], allUsers=[], promotions=[];
let unsub={};
let currentUser=null;

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function toast(t){const x=$('#toast');if(!x)return;x.textContent=t;x.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>x.classList.remove('show'),3000);}
function formatPrice(v){return Number(v||0).toLocaleString('fr-DZ')+' دج';}
function showLoading(on){const x=$('#loadingOverlay');if(x)x.hidden=!on;}
function cloudinaryUrl(url,w=200,h=200){
  if(!url||!url.includes('res.cloudinary.com'))return url;
  return url.replace('/upload/',`/upload/f_auto,q_auto,w_${w},h_${h},c_limit/`);
}

const DELIVERY_STATUS_LABEL={
  pending_review:'⏳ قيد مراجعة الهوية', approved:'✅ تمت الموافقة، بانتظار موصّل',
  assigned:'🚚 تم تعيين موصّل', picked_up:'📦 تم الاستلام', delivering:'🚗 في الطريق',
  completed:'✅ تم التسليم', rejected:'❌ مرفوض', cancelled:'✖️ ملغى'
};

function showGate(status){ $('#gateView').hidden=false; $('#deniedView').hidden=true; $('#dashboardView').hidden=true; if(status)$('#gateStatus').textContent=status; }
function showDenied(){ $('#gateView').hidden=true; $('#deniedView').hidden=false; $('#dashboardView').hidden=true; }
function showDashboard(){ $('#gateView').hidden=true; $('#deniedView').hidden=true; $('#dashboardView').hidden=false; }

$('#adminLoginBtn').onclick=async()=>{
  try{ await signInWithPopup(auth, googleProvider); }
  catch(e){ if(e.code!=='auth/popup-closed-by-user') toast('تعذر تسجيل الدخول: '+e.code); }
};
$('#adminLogoutBtn').onclick=()=>signOut(auth);
$('#dashLogoutBtn').onclick=()=>signOut(auth);

onAuthStateChanged(auth, async user=>{
  currentUser=user;
  if(!user){ Object.values(unsub).forEach(u=>u&&u()); unsub={}; showGate('لم تسجل الدخول بعد.'); return; }
  if(user.email!==ADMIN_EMAIL){
    showDenied();
    return;
  }
  try{
    // يثبّت صلاحية الأدمن في Firestore تلقائياً لهذا الحساب فقط، باش تخدم قواعد الأمان الجانبية أيضاً
    const ref=doc(db,'users',user.uid);
    const snap=await getDoc(ref);
    if(!snap.exists()){
      await setDoc(ref,{uid:user.uid,displayName:user.displayName||'الإدارة',email:user.email||'',photoURL:user.photoURL||'',role:'admin',verified:true,banned:false,createdAt:serverTimestamp()});
    }else if(snap.data().role!=='admin'){
      await updateDoc(ref,{role:'admin',updatedAt:serverTimestamp()});
    }
    showDashboard();
    subscribeAll();
  }catch(e){ console.error(e); toast('صار خطأ أثناء التحقق من الحساب.'); }
});

function subscribeAll(){
  if(unsub.listings)unsub.listings();
  unsub.listings=onSnapshot(collection(db,'listings'),s=>{listings=s.docs.map(d=>({id:d.id,...d.data()}));renderAll();},e=>console.error(e));
  if(unsub.drivers)unsub.drivers();
  unsub.drivers=onSnapshot(collection(db,'drivers'),s=>{drivers=s.docs.map(d=>({id:d.id,...d.data()}));renderAll();},e=>console.error(e));
  if(unsub.deliveryRequests)unsub.deliveryRequests();
  unsub.deliveryRequests=onSnapshot(collection(db,'deliveryRequests'),s=>{deliveryRequests=s.docs.map(d=>({id:d.id,...d.data()}));renderAll();},e=>console.error(e));
  if(unsub.reports)unsub.reports();
  unsub.reports=onSnapshot(collection(db,'reports'),s=>{reports=s.docs.map(d=>({id:d.id,...d.data()}));renderAll();},e=>console.error(e));
  if(unsub.users)unsub.users();
  unsub.users=onSnapshot(collection(db,'users'),s=>{allUsers=s.docs.map(d=>({uid:d.id,...d.data()}));renderAll();},e=>console.error(e));
  if(unsub.promotions)unsub.promotions();
  unsub.promotions=onSnapshot(collection(db,'promotions'),s=>{promotions=s.docs.map(d=>({id:d.id,...d.data()}));renderAll();},e=>console.error(e));
}

function renderAll(){
  $('#statListings').textContent=listings.length;
  $('#statDrivers').textContent=drivers.length;
  $('#statReports').textContent=reports.filter(r=>r.status==='open').length;
  $('#statDeliveryRequests').textContent=deliveryRequests.length;
  $('#statUsers').textContent=allUsers.length;
  $('#statPromotions').textContent=promotions.length;

  const pendingListings=listings.filter(x=>x.status==='pending');
  $('#adminPendingListings').innerHTML=pendingListings.length?pendingListings.map(x=>`<div class="admin-item"><b>${escapeHtml(x.title)}</b><div class="meta">${formatPrice(x.price)} • ${escapeHtml(x.flagReason||'')}</div>
    <div class="admin-item-actions">
    <button class="small-btn success" data-approve-listing="${x.id}">✅ نشر</button>
    <button class="small-btn danger" data-reject-listing="${x.id}">❌ رفض</button>
    </div></div>`).join(''):'<div class="empty small-empty">ما كاش إعلانات قيد المراجعة.</div>';
  $$('[data-approve-listing]').forEach(b=>b.onclick=()=>moderateListing(b.dataset.approveListing,'published'));
  $$('[data-reject-listing]').forEach(b=>b.onclick=()=>moderateListing(b.dataset.rejectListing,'rejected'));

  $('#adminListings').innerHTML=listings.slice(0,60).map(x=>`<div class="admin-item"><b>${escapeHtml(x.title)}</b><div class="meta">${formatPrice(x.price)} • ${escapeHtml(x.status||'')}</div>
    <div class="admin-item-actions">
    ${x.status==='published'?`<button class="small-btn" data-unpublish-listing="${x.id}">إخفاء</button>`:''}
    <button class="small-btn danger" data-delete-listing="${x.id}">حذف</button>
    </div></div>`).join('')||'<div class="empty small-empty">لا إعلانات.</div>';
  $$('[data-unpublish-listing]').forEach(b=>b.onclick=()=>moderateListing(b.dataset.unpublishListing,'pending'));
  $$('[data-delete-listing]').forEach(b=>b.onclick=()=>removeDoc('listings',b.dataset.deleteListing,'الإعلان'));

  $('#adminDrivers').innerHTML=drivers.length?drivers.map(d=>`<div class="admin-item"><b>${escapeHtml(d.name||'موصل')}</b><div class="meta">${escapeHtml(d.wilaya||'')} • ${escapeHtml(d.phone||'')} • ${escapeHtml(d.status||'')}</div>
    <div class="admin-item-actions">
    ${d.status!=='approved'?`<button class="small-btn success" data-approve-driver="${d.id}">قبول</button>`:''}
    ${d.status!=='rejected'?`<button class="small-btn danger" data-reject-driver="${d.id}">رفض</button>`:''}
    </div></div>`).join(''):'<div class="empty small-empty">لا توجد طلبات.</div>';
  $$('[data-approve-driver]').forEach(b=>b.onclick=()=>driverAction(b.dataset.approveDriver,'approved',true));
  $$('[data-reject-driver]').forEach(b=>b.onclick=()=>driverAction(b.dataset.rejectDriver,'rejected',false));

  const approvedDrivers=drivers.filter(d=>d.status==='approved'&&d.verified);
  $('#adminDeliveryRequests').innerHTML=deliveryRequests.length?deliveryRequests.map(r=>`<div class="admin-item">
    <b>${escapeHtml(r.listingTitle||'طلب توصيل')}</b>
    <div class="meta">${escapeHtml(r.buyerName||'')} • ${escapeHtml(r.phone||'')} • ${escapeHtml(r.wilaya||'')} - ${escapeHtml(r.city||'')}</div>
    <div class="meta">${escapeHtml(r.address||'')}</div>
    <div class="kyc-thumbs">
      ${r.idCardUrl?`<img src="${escapeHtml(cloudinaryUrl(r.idCardUrl))}" alt="بطاقة التعريف" title="بطاقة التعريف">`:''}
      ${r.selfieUrl?`<img src="${escapeHtml(cloudinaryUrl(r.selfieUrl))}" alt="سيلفي" title="سيلفي">`:''}
    </div>
    <span class="tracking-status status-pending">${DELIVERY_STATUS_LABEL[r.status]||r.status}</span>
    <div class="admin-item-actions">
      ${r.status==='pending_review'?`<button class="small-btn success" data-dr-approve="${r.id}">✅ قبول الهوية</button><button class="small-btn danger" data-dr-reject="${r.id}">❌ رفض</button>`:''}
      ${r.status==='approved'?`<select class="small-select" data-dr-assign="${r.id}"><option value="">اختار موصّل...</option>${approvedDrivers.map(d=>`<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)} (${escapeHtml(d.wilaya)})</option>`).join('')}</select>`:''}
    </div></div>`).join(''):'<div class="empty small-empty">ما كاش طلبات توصيل.</div>';
  $$('[data-dr-approve]').forEach(b=>b.onclick=()=>updateDeliveryStatus(b.dataset.drApprove,'approved'));
  $$('[data-dr-reject]').forEach(b=>b.onclick=()=>updateDeliveryStatus(b.dataset.drReject,'rejected'));
  $$('[data-dr-assign]').forEach(sel=>sel.onchange=()=>{if(sel.value)assignDriver(sel.dataset.drAssign,sel.value);});

  $('#adminReports').innerHTML=reports.length?reports.map(r=>`<div class="admin-item"><b>${escapeHtml(r.reason||'بلاغ')}</b><div class="meta">${escapeHtml(r.targetType||'')} • من: ${escapeHtml(r.reporterName||'')}</div>${r.details?`<div class="meta">${escapeHtml(r.details)}</div>`:''}<span class="tracking-status status-pending">${r.status==='open'?'⏳ مفتوح':'✅ تمت المعالجة'}</span>
    ${r.status==='open'?`<div class="admin-item-actions"><button class="small-btn success" data-resolve-report="${r.id}">وسمّه كمُعالج</button></div>`:''}
    </div>`).join(''):'<div class="empty small-empty">لا بلاغات.</div>';
  $$('[data-resolve-report]').forEach(b=>b.onclick=()=>resolveReport(b.dataset.resolveReport));

  $('#adminUsers').innerHTML=allUsers.length?allUsers.slice(0,60).map(u=>`<div class="admin-item"><b>${escapeHtml(u.displayName||'مستخدم')}</b><div class="meta">${escapeHtml(u.email||'')} ${u.role==='admin'?'• 🛡️ أدمن':''}${u.verified?' • ✓ موثّق':''}${u.banned?' • 🚫 موقوف':''}</div>
    <div class="admin-item-actions">
    ${u.role!=='admin'?`<button class="small-btn ${u.verified?'':'success'}" data-toggle-verify="${u.uid}">${u.verified?'إلغاء التوثيق':'توثيق'}</button>
    <button class="small-btn ${u.banned?'success':'danger'}" data-toggle-ban="${u.uid}">${u.banned?'رفع الإيقاف':'إيقاف'}</button>`:'<span class="meta">حساب الإدارة</span>'}
    </div></div>`).join(''):'<div class="empty small-empty">لا مستخدمين.</div>';
  $$('[data-toggle-verify]').forEach(b=>b.onclick=()=>toggleUserFlag(b.dataset.toggleVerify,'verified'));
  $$('[data-toggle-ban]').forEach(b=>b.onclick=()=>toggleUserFlag(b.dataset.toggleBan,'banned'));

  $('#adminPromotions').innerHTML=promotions.length?promotions.map(p=>`<div class="admin-item"><b>${escapeHtml(p.name)}</b><div class="meta">${escapeHtml(p.type)} • ${escapeHtml(p.status)}</div>
    <div class="admin-item-actions">
    ${p.status!=='approved'?`<button class="small-btn success" data-approve-promo="${p.id}">قبول</button>`:''}
    ${p.status!=='rejected'?`<button class="small-btn danger" data-reject-promo="${p.id}">رفض</button>`:''}
    </div></div>`).join(''):'<div class="empty small-empty">لا ترويجات.</div>';
  $$('[data-approve-promo]').forEach(b=>b.onclick=()=>moderatePromotion(b.dataset.approvePromo,'approved'));
  $$('[data-reject-promo]').forEach(b=>b.onclick=()=>moderatePromotion(b.dataset.rejectPromo,'rejected'));

  const flagged=listings.filter(x=>x.flagged&&x.status==='pending');
  $('#aiAdminAlerts').innerHTML=flagged.length?flagged.map(x=>`<div class="admin-item"><b>⚠️ ${escapeHtml(x.title)}</b><div class="meta">${escapeHtml(x.flagReason||'محتوى مشبوه')}</div></div>`).join(''):'<div class="empty small-empty">ما كاش تنبيهات حالياً.</div>';
}

async function moderateListing(id,status){
  try{await updateDoc(doc(db,'listings',id),{status,updatedAt:serverTimestamp()});toast(status==='published'?'تم نشر الإعلان ✅':status==='pending'?'تم إخفاء الإعلان':'تم رفض الإعلان');}catch(e){toast('تعذر تحديث الإعلان');}
}
async function removeDoc(col,id,label){
  if(!confirm(`متأكد من حذف ${label}؟`))return;
  try{await deleteDoc(doc(db,col,id));toast('تم الحذف ✅');}catch(e){toast('تعذر الحذف');}
}
async function driverAction(id,status,verified){
  try{await updateDoc(doc(db,'drivers',id),{status,verified,updatedAt:serverTimestamp()});toast(status==='approved'?'تم قبول الموصل ✅':'تم إيقاف الموصل.');}catch(e){toast('تعذر تحديث الموصل.');}
}
async function assignDriver(reqId,driverId){
  try{await updateDoc(doc(db,'deliveryRequests',reqId),{driverId,status:'assigned',updatedAt:serverTimestamp()});toast('تم تعيين الموصّل 🚚');}catch(e){toast('تعذر تعيين الموصّل');}
}
async function updateDeliveryStatus(id,status){
  try{await updateDoc(doc(db,'deliveryRequests',id),{status,updatedAt:serverTimestamp()});toast('تم تحديث الحالة ✅');}catch(e){toast('تعذر التحديث');}
}
async function resolveReport(id){
  try{await updateDoc(doc(db,'reports',id),{status:'resolved',updatedAt:serverTimestamp()});toast('تم وسم البلاغ كمُعالج ✅');}catch(e){toast('تعذر تحديث البلاغ');}
}
async function toggleUserFlag(uid,field){
  const u=allUsers.find(x=>x.uid===uid);if(!u)return;
  try{await updateDoc(doc(db,'users',uid),{[field]:!u[field],updatedAt:serverTimestamp()});toast('تم التحديث ✅');}catch(e){toast('تعذر التحديث');}
}
async function moderatePromotion(id,status){
  try{await updateDoc(doc(db,'promotions',id),{status,updatedAt:serverTimestamp()});toast(status==='approved'?'تم قبول الترويج ✅':'تم رفض الترويج');}catch(e){toast('تعذر تحديث الترويج');}
}

showGate('جاري التحقق...');
