import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  getFirestore, collection, addDoc, doc, getDoc, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit, where, onSnapshot, serverTimestamp, arrayUnion, arrayRemove,
  getDocs, writeBatch, increment, startAfter, documentId
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app-check.js';
import { firebaseConfig, appCheckSiteKey } from './firebase-config.js';

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
googleProvider.setCustomParameters({ prompt: 'select_account' });

const CLOUDINARY_CLOUD_NAME = 'prp1oxzx';
const CLOUDINARY_UPLOAD_PRESET = 'Storedz';

const categories = [
  ['🚗','سيارات ومركبات'],['📱','هواتف وإلكترونيات'],['🏠','أثاث وديكور'],['👕','ملابس وأزياء'],
  ['🏢','العقار'],['🛠️','الخدمات'],['🌾','الفلاحة'],['🏭','معدات ومهنية'],
  ['🎮','ألعاب وترفيه'],['📚','كتب ودراسة'],['👶','الأطفال والأم'],['🐕','حيوانات'],
  ['🎁','أخرى']
];

const wilayas = ['أدرار','الشلف','الأغواط','أم البواقي','باتنة','بجاية','بسكرة','بشار','البليدة','البويرة','تمنراست','تبسة','تلمسان','تيارت','تيزي وزو','الجزائر','الجلفة','جيجل','سطيف','سعيدة','سكيكدة','سيدي بلعباس','عنابة','قالمة','قسنطينة','المدية','مستغانم','المسيلة','معسكر','ورقلة','وهران','البيض','إليزي','برج بوعريريج','بومرداس','الطارف','تندوف','تيسمسيلت','الوادي','خنشلة','سوق أهراس','تيبازة','ميلة','عين الدفلى','النعامة','عين تموشنت','غرداية','غليزان','تيميمون','برج باجي مختار','أولاد جلال','بني عباس','إن صالح','إن قزام','تقرت','جانت','المغير','المنيعة'];

// ----- Spam / trust engine -----
const SPAM_WORDS_BLOCK = ['نصب','مخدرات','سلاح','إباحي','scam','fake id','مسروق'];
const SPAM_WORDS_FLAG = ['احتيال','ربح سريع','اربح المال','مضمون 100%','fast money','click here','اتصل الآن فقط','win money'];
const URL_REGEX = /(https?:\/\/|www\.)\S+/gi;

function analyzeSpam(text){
  const t=String(text||'').toLowerCase();
  if(SPAM_WORDS_BLOCK.some(w=>t.includes(w)))return{blocked:true,flagged:true,reason:'كلمات ممنوعة'};
  const reasons=[];
  if(SPAM_WORDS_FLAG.some(w=>t.includes(w)))reasons.push('كلمات مشبوهة');
  const urlMatches=t.match(URL_REGEX);
  if(urlMatches&&urlMatches.length>=2)reasons.push('روابط متعددة');
  if(/(.)\1{5,}/.test(t))reasons.push('تكرار حروف غير طبيعي');
  const letters=t.replace(/[^a-zA-Z]/g,'');
  if(letters.length>15){const upper=letters.replace(/[^A-Z]/g,'');if(upper.length/letters.length>0.7)reasons.push('حروف كبيرة مفرطة');}
  return{blocked:false,flagged:reasons.length>0,reason:reasons.join('، ')};
}

// ----- الفحص الآلي للإعلانات: النشر مباشر، والنتيجة تتسجل فالإعلان باش الأدمن يراجع اللاحق -----
function screenListing({title,description,price,phone,images}){
  const base=analyzeSpam(title+' '+description);
  if(base.blocked)return{blocked:true,score:100,reasons:[base.reason]};
  const reasons=base.reason?base.reason.split('، '):[];let score=base.flagged?40:0;
  const text=(title+' '+description);
  if(!images.length){reasons.push('بدون صور');score+=15;}
  if(!(price>0)){reasons.push('سعر غير صالح');score+=30;}
  else if(price>2000000000){reasons.push('سعر مبالغ فيه جداً');score+=30;}
  if(String(title).trim().length<5){reasons.push('عنوان قصير جداً');score+=10;}
  if(/(\+?\d[\s.-]?){9,}/.test(String(description))&&!phone){reasons.push('أرقام هاتف داخل الوصف');score+=10;}
  if(/(t\.me|telegram|bit\.ly|tinyurl|wa\.me)/i.test(text)){reasons.push('روابط خارجية مشبوهة');score+=25;}
  return{blocked:false,score:Math.min(score,99),reasons};
}

function isDuplicatePost(title,ownerUid){
  const norm=String(title||'').trim().toLowerCase();
  if(!norm)return false;
  const recentWindow=10*60*1000;
  const nowApprox=Date.now();
  return myListings.some(l=>{
    if(l.ownerUid!==ownerUid)return false;
    if(String(l.title||'').trim().toLowerCase()!==norm)return false;
    const created=l.createdAt?.seconds?l.createdAt.seconds*1000:nowApprox;
    return (nowApprox-created)<recentWindow;
  });
}

let driverPool=[];
let listings=[], drivers=[], favorites=[], conversations=[], blocked=[], notifications=[];
let promotions=[], deliveryRequests=[], usersList=[];
let currentUser=null, currentProfile=null;
let isAdmin=false, myDriver=null, activeConversation=null;
let unsub={};
let suggestionTimer=null;
let currentImages=[];
let pendingLocation=null;
let ratingTarget=null;

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function toast(t){const x=$('#toast');if(!x)return;x.textContent=t;x.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>x.classList.remove('show'),3000);}
function formatPrice(v){return Number(v||0).toLocaleString('fr-DZ')+' دج';}
function setFirebaseState(t,g=false){const x=$('#firebaseState');if(x){x.textContent=t;x.className='notice '+(g?'notice-success':'');}}
function requireLogin(){if(!currentUser){toast('لازم تسجل الدخول أولاً 🔐');go('account');return false;}return true;}
function cdCheck(key,ms,msg){
  const now=Date.now();let last=0;
  try{last=Number(localStorage.getItem('cd_'+key))||0;}catch{}
  if(now-last<ms){toast(msg||'⏳ رويدك شوية قبل المحاولة التالية.');return false;}
  try{localStorage.setItem('cd_'+key,String(now));}catch{}
  return true;
}
function showLoading(on){const x=$('#loadingOverlay');if(x)x.hidden=!on;}

function go(view,params={}){
  $$('.view').forEach(v=>v.classList.remove('active'));
  const target=$(`#${view}View`);
  if(target)target.classList.add('active');
  else $('#homeView').classList.add('active');
  window.scrollTo({top:0,behavior:'smooth'});
  if(view==='search')applyFilters();
  if(view==='favorites')renderFavorites();
  if(view==='account'){renderConversations();renderBlocked();loadMyListings();renderMyDeliveries();renderMyDriverDeliveries();}
  if(view==='delivery')loadDrivers();
  if(view==='promotions')loadPromotions();
  if(view==='profile'&&params.uid)renderProfile(params.uid);
  if(view==='tracking')renderTracking();
  $$('.mobile-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  const url=new URL(window.location.href);
  url.searchParams.set('view',view);
  window.history.replaceState({},'',url);
}

function initDarkMode(){
  if(localStorage.getItem('darkMode')==='true')document.documentElement.setAttribute('data-theme','dark');
  $('#darkModeToggle').onclick=()=>{
    const dark=document.documentElement.getAttribute('data-theme')==='dark';
    localStorage.setItem('darkMode',!dark);
    document.documentElement.setAttribute('data-theme',!dark?'dark':'');
    $('#darkModeToggle').textContent=!dark?'☀️':'🌙';
  };
}

function selectOptions(){
  const opts=categories.map(([i,n])=>`<option value="${escapeHtml(n)}">${i} ${escapeHtml(n)}</option>`).join('');
  const all=wilayas.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
  const fc=$('#filterCategory'),pc=$('#postCategory'),dc=$('#driverWilaya'),prc=$('#promoWilaya'),drc=$('#deliveryReqWilaya');
  if(fc)fc.innerHTML='<option value="">كل الأقسام</option>'+opts;
  if(pc)pc.innerHTML='<option value="">اختار القسم</option>'+opts;
  if(dc)dc.innerHTML='<option value="">اختار الولاية</option>'+all;
  if(prc)prc.innerHTML='<option value="">اختار الولاية</option>'+all;
  if(drc)drc.innerHTML='<option value="">اختار الولاية</option>'+all;
  const fw=$('#filterWilaya'),pw=$('#postWilaya');
  if(fw)fw.innerHTML='<option value="">كل الولايات</option>'+all;
  if(pw)pw.innerHTML='<option value="">اختار الولاية</option>'+all;
}

// ----- بحث محفوظ واقتراحات فورية -----
function currentSearchSnapshot(){
  const f=readFilters();
  return {q:f.q,category:f.category,wilaya:f.wilaya,city:f.city,min:f.min||0,max:Number.isFinite(f.max)?f.max:'',delivery:f.delivery,verified:f.verified,condition:f.condition};
}
function renderSavedSearches(){
  const el=$('#savedSearches');if(!el)return;
  let items=[];try{items=JSON.parse(localStorage.getItem('souq_saved_searches')||'[]');}catch{}
  el.innerHTML=items.length?'<b class="saved-search-label">عمليات محفوظة:</b>'+items.map((x,i)=>`<button type="button" class="saved-search-chip" data-saved-search="${i}">${escapeHtml(x.label||x.q||x.category||'بحث')} <span aria-hidden="true">×</span></button>`).join(''):'';
  $$('#savedSearches [data-saved-search]').forEach(b=>b.onclick=()=>{
    const i=Number(b.dataset.savedSearch);const item=items[i];if(!item)return;
    $('#globalSearch').value=item.q||'';$('#filterCategory').value=item.category||'';$('#filterWilaya').value=item.wilaya||'';
    $('#filterCity').value=item.city||'';$('#minPrice').value=item.min||'';$('#maxPrice').value=item.max||'';
    $('#filterDelivery').checked=!!item.delivery;$('#filterVerified').checked=!!item.verified;$('#filterCondition').value=item.condition||'';
    applyFilters();
  });
}
function saveCurrentSearch(){
  const item=currentSearchSnapshot();
  if(!item.q&&!item.category&&!item.wilaya&&!item.city&&!item.min&&!item.max&&!item.delivery&&!item.verified&&!item.condition){toast('حدد كلمة أو فلتر قبل حفظ البحث.');return;}
  let items=[];try{items=JSON.parse(localStorage.getItem('souq_saved_searches')||'[]');}catch{}
  const key=JSON.stringify(item);if(items.some(x=>JSON.stringify(x)===key)){toast('هذا البحث محفوظ من قبل.');return;}
  item.label=item.q||item.category||item.wilaya||item.city||'بحث مخصص';items.unshift(item);items=items.slice(0,8);
  try{localStorage.setItem('souq_saved_searches',JSON.stringify(items));renderSavedSearches();toast('تم حفظ البحث على هذا الجهاز ✅');}catch{toast('تعذر حفظ البحث في المتصفح.');}
}
function renderSearchSuggestions(){
  const input=$('#globalSearch'),box=$('#searchSuggestions');if(!input||!box)return;
  const q=normalizeWord(input.value.trim());
  if(q.length<2){box.hidden=true;input.setAttribute('aria-expanded','false');return;}
  const matches=[...listingMap.values()].filter(x=>x.status==='published'&&isVisibleListing(x)&&normalizeWord(x.title||'').includes(q)).slice(0,6);
  if(!matches.length){box.hidden=true;input.setAttribute('aria-expanded','false');return;}
  box.innerHTML=matches.map(x=>`<button type="button" role="option" class="suggestion-item" data-suggest-id="${escapeHtml(x.id)}"><span>${escapeHtml(x.title)}</span><small>${formatPrice(x.price)} · ${escapeHtml(x.wilaya||'')}</small></button>`).join('');
  box.hidden=false;input.setAttribute('aria-expanded','true');
  $$('#searchSuggestions [data-suggest-id]').forEach(b=>b.onclick=()=>{box.hidden=true;input.setAttribute('aria-expanded','false');go('home');openListing(b.dataset.suggestId);});
}
function renderNotifications(){
  const el=$('#notificationList');if(!el)return;
  const unread=notifications.filter(n=>!n.read).length;
  const badge=$('#notificationBadge');if(badge){badge.textContent=unread>99?'99+':String(unread);badge.hidden=!unread;}
  if(!currentUser){el.innerHTML='<div class="empty small-empty">سجّل الدخول باش تشوف إشعاراتك.</div>';return;}
  el.innerHTML=notifications.length?notifications.map(n=>`<button type="button" class="notification-item ${n.read?'is-read':'is-unread'}" data-notification="${escapeHtml(n.id)}"><b>${escapeHtml(n.title||'إشعار')}</b><span>${escapeHtml(n.body||'')}</span><small>${n.createdAt?.seconds?new Date(n.createdAt.seconds*1000).toLocaleString('ar-DZ'): 'الآن'}</small></button>`).join(''):'<div class="empty small-empty">ما عندك حتى إشعار حالياً.</div>';
  $$('#notificationList [data-notification]').forEach(b=>b.onclick=async()=>{
    const n=notifications.find(x=>x.id===b.dataset.notification);if(!n)return;
    if(!n.read){try{await updateDoc(doc(db,'notifications',n.id),{read:true});}catch(e){console.warn('Notification read:',e);}}
    if(n.conversationId){const c=conversations.find(x=>x.id===n.conversationId);const other=c?.participants?.find(uid=>uid!==currentUser.uid);if(other)openConversationWith(other,{id:c.listingId,title:c.listingTitle});}
    else if(n.deliveryRequestId){go('tracking');renderTracking();}
  });
}
function categoryCards(target){
  const el=$(target);if(!el)return;
  el.innerHTML=categories.map(([icon,name])=>`<button class="category" data-cat="${escapeHtml(name)}"><span class="icon">${icon}</span><b>${escapeHtml(name)}</b></button>`).join('');
  $$(target+' .category').forEach(b=>b.onclick=()=>{go('search');$('#filterCategory').value=b.dataset.cat;applyFilters();});
}

function cloudinaryUrl(url,w=800,h=600){
  if(!url||!url.includes('res.cloudinary.com'))return url;
  return url.replace('/upload/',`/upload/f_auto,q_auto,w_${w},h_${h},c_limit/`);
}

async function uploadImageToCloudinary(file,folder='souq-algeria/listings'){
  if(!file)return'';
  if(CLOUDINARY_CLOUD_NAME.startsWith('YOUR_')||CLOUDINARY_UPLOAD_PRESET.startsWith('YOUR_'))throw new Error('كمّل إعداد Cloudinary أولاً.');
  const allowed=['image/jpeg','image/png','image/webp'];if(!allowed.includes(file.type))throw new Error('استعمل JPG أو PNG أو WebP.');
  if(file.size>8*1024*1024)throw new Error('الصورة كبيرة بزاف. الحد الأقصى 8MB.');
  const form=new FormData();form.append('file',file);form.append('upload_preset',CLOUDINARY_UPLOAD_PRESET);form.append('folder',folder);
  const res=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUDINARY_CLOUD_NAME)}/image/upload`,{method:'POST',body:form});
  const data=await res.json();if(!res.ok||!data.secure_url)throw new Error(data.error?.message||'فشل رفع الصورة.');
  return data.secure_url;
}

function renderImagePreview(){
  const el=$('#imagePreviewGrid');if(!el)return;
  el.innerHTML=currentImages.map((url,i)=>`<div class="image-preview"><img src="${escapeHtml(cloudinaryUrl(url,200,200))}" alt=""><button type="button" class="remove-img" data-i="${i}">×</button></div>`).join('');
  $$('#imagePreviewGrid .remove-img').forEach(b=>b.onclick=()=>{currentImages.splice(Number(b.dataset.i),1);renderImagePreview();});
}

function initImageUpload(){
  const input=$('#imageFileInput');if(!input)return;
  input.addEventListener('change',async()=>{
    const files=[...input.files].slice(0,5-currentImages.length);
    if(!files.length)return;
    showLoading(true);
    try{
      for(const f of files){
        const url=await uploadImageToCloudinary(f);
        currentImages.push(url);
      }
      renderImagePreview();
      toast('تم رفع الصور ✅');
    }catch(e){toast(e.message||'فشل رفع الصورة');}
    finally{showLoading(false);input.value='';}
  });
}

function collectImageUrls(){
  const raw=$('#imageUrlInput')?.value||'';
  const urls=raw.split(',').map(s=>s.trim()).filter(s=>s.startsWith(`https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/`));
  return[...currentImages,...urls].slice(0,5);
}

function statusMeta(d){
  const s=d.activityStatus==='active'?'active':d.activityStatus==='busy'?'busy':'offline';
  const label=s==='active'?'متصل الآن':s==='busy'?'مشغول':'غير متصل';
  const lastSeen=d.lastSeenAt?new Date(d.lastSeenAt.seconds*1000).toLocaleTimeString('ar-DZ',{hour:'2-digit',minute:'2-digit'}):'';
  return {s,label,lastSeen};
}

function card(x){
  const active=favorites.includes(x.id);
  const img=x.images?.[0]||x.image||'';
  const rating=x.ratingCount?(x.ratingSum/x.ratingCount).toFixed(1):null;
  return `<article class="listing" data-id="${escapeHtml(x.id)}"><div class="listing-img">
  ${img?`<img src="${escapeHtml(cloudinaryUrl(img,600,450))}" alt="${escapeHtml(x.title)}" loading="lazy" decoding="async">`:`<span>${escapeHtml(x.emoji||'🛍️')}</span>`}
  ${(x.images||[]).length>1?`<span class="img-count">📷 ${x.images.length}</span>`:''}<button class="heart ${active?'active':''}" data-fav="${escapeHtml(x.id)}">${active?'♥':'♡'}</button></div>
  <div class="listing-body"><div class="meta">${escapeHtml(x.condition||'متاح')} • ${escapeHtml(x.category)}</div>
  <div class="listing-title">${escapeHtml(x.title)}</div><div class="price">${formatPrice(x.price)}</div>
  <div class="meta">📍 ${escapeHtml(x.wilaya||'الجزائر')} • 👤 ${escapeHtml(x.seller||'بائع')}${x.sellerVerified?' <span class="verified">✓</span>':''}</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
  ${x.delivery?'<span class="delivery-chip">🚗 توصيل</span>':''}
  ${rating?`<span class="rating-display">⭐ ${rating}</span>`:''}
  ${x.status==='hidden'?'<span class="spam-flag">🙈 مخفي من الإدارة</span>':''}
  </div></div></article>`;
}

// ================= الإعلانات: تحميل بالصفحات (Pagination) =================
// بدل ما نحمّلو 300 إعلان فكل زيارة: الرئيسية 12 قراءة، والبحث 24 إعلان فكل صفحة + زر "عرض المزيد".
const PAGE_SIZE=24;
const listingMap=new Map();           // كاش لكل إعلان تحمّل فهاذ الجلسة
let homeItems=[], homeLoaded=false, myListings=[], myListingsLoaded=false;
const goneIds=new Set();              // معرّفات مفضلة محذوفة (ما نعاودوش نطلبوها)
const searchState={items:[],cursor:null,done:false,loading:false,seq:0,key:'',loaded:false};

function isVisibleListing(x){
  if(!x||x.status==='rejected')return false;
  if(blocked.some(b=>b.blockedUid===x.ownerUid))return false;
  return x.status==='published'||x.ownerUid===currentUser?.uid||isAdmin;
}
function visiblePublicListings(){return listings.filter(isVisibleListing);}

function cacheListings(docs){
  docs.forEach(d=>listingMap.set(d.id,{id:d.id,...d.data()}));
  listings=[...listingMap.values()];
}
function handleQueryError(e){
  console.error(e);
  toast(e?.code==='failed-precondition'?'⚙️ هذا البحث يحتاج فهرس Firestore: افتح Console وانقر الرابط الأزرق.':'تعذر تحميل الإعلانات، حاول مجدداً.');
}

// ---------- كلمات البحث (بحث بالكلمة الكاملة، مع توحيد الحروف العربية) ----------
function normalizeWord(w){
  let s=String(w||'').toLowerCase()
    .replace(/[ً-ٰٟـ]/g,'')
    .replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه');
  if(s.length>3&&s.startsWith('ال'))s=s.slice(2);
  return s;
}
function tokenize(text){
  const out=[];
  String(text||'').split(/[^\p{L}\p{N}]+/u).forEach(w=>{const n=normalizeWord(w);if(n.length>=2&&!out.includes(n))out.push(n);});
  return out;
}
function buildKeywords({title,category,wilaya,city}){return tokenize(`${title} ${category} ${wilaya} ${city||''}`).slice(0,24);}

// ---------- الرئيسية ----------
async function loadHome(){
  try{
    const snap=await getDocs(query(collection(db,'listings'),where('status','==','published'),orderBy('createdAt','desc'),limit(12)));
    cacheListings(snap.docs);
    homeItems=snap.docs.map(d=>listingMap.get(d.id));
  }catch(e){handleQueryError(e);}
  homeLoaded=true;renderHome();
}
function renderHome(){
  if(!promosLoaded&&!window._promoReq){window._promoReq=1;loadPromotions();}
  const el=$('#homeListings');if(!el)return;
  if(!homeLoaded){el.innerHTML='<div class="empty">جاري التحميل...</div>';return;}
  renderListings(homeItems.filter(isVisibleListing).slice(0,8),'#homeListings');
}

// ---------- إعلاناتي ----------
async function loadMyListings(force=false){
  if(!currentUser){myListings=[];renderMyListings();return;}
  if(myListingsLoaded&&!force){renderMyListings();return;}
  try{
    const snap=await getDocs(query(collection(db,'listings'),where('ownerUid','==',currentUser.uid)));
    cacheListings(snap.docs);
    myListings=snap.docs.map(d=>listingMap.get(d.id)).sort((p,q)=>(q.createdAt?.seconds||0)-(p.createdAt?.seconds||0));
    myListingsLoaded=true;
  }catch(e){console.error(e);}
  renderMyListings();
}
function forgetListing(id){
  listingMap.delete(id);listings=[...listingMap.values()];
  myListings=myListings.filter(l=>l.id!==id);homeItems=homeItems.filter(l=>l.id!==id);
  searchState.items=searchState.items.filter(l=>l.id!==id);searchState.key='';
  renderAll();renderMyListings();
}

// ---------- المفضلة: نجيبو غير اللي ماشي فالكاش ----------
async function ensureListings(ids){
  const missing=ids.filter(id=>!listingMap.has(id)&&!goneIds.has(id));
  for(let i=0;i<missing.length;i+=10){
    const chunk=missing.slice(i,i+10);
    const snap=await getDocs(query(collection(db,'listings'),where('status','==','published'),where(documentId(),'in',chunk)));
    cacheListings(snap.docs);
    chunk.forEach(id=>{if(!listingMap.has(id))goneIds.add(id);});
  }
}
async function renderFavorites(){
  if(!$('#favoritesView')?.classList.contains('active'))return;
  try{await ensureListings(favorites.slice(0,60));}catch(e){console.error(e);}
  renderListings(favorites.map(id=>listingMap.get(id)).filter(isVisibleListing),'#favoritesGrid');
}

// ---------- البحث بالصفحات ----------
function readFilters(){
  const raw=$('#globalSearch')?.value||'';
  return{
    q:raw.trim(),tokens:tokenize(raw),
    category:$('#filterCategory')?.value||'',wilaya:$('#filterWilaya')?.value||'',
    city:($('#filterCity')?.value||'').trim().toLowerCase(),
    min:Number($('#minPrice')?.value||0),max:Number($('#maxPrice')?.value||Infinity),
    delivery:!!$('#filterDelivery')?.checked,verified:!!$('#filterVerified')?.checked,
    condition:$('#filterCondition')?.value||''
  };
}
function matchesFilters(x,f){
  if(!isVisibleListing(x))return false;
  if(f.category&&x.category!==f.category)return false;
  if(f.wilaya&&x.wilaya!==f.wilaya)return false;
  if(f.city&&!String(x.city||'').toLowerCase().includes(f.city))return false;
  const p=Number(x.price);
  if(!(p>=f.min&&p<=f.max))return false;
  if(f.delivery&&!x.delivery)return false;
  if(f.verified&&!x.sellerVerified)return false;
  if(f.condition&&x.condition!==f.condition)return false;
  if(f.tokens.length){
    const kw=Array.isArray(x.keywords)?x.keywords:tokenize(`${x.title} ${x.category} ${x.wilaya} ${x.city||''}`);
    if(!f.tokens.every(t=>kw.includes(t)))return false;
  }
  return true;
}
// فلتر واحد فقط يمشي للسيرفر (كلمة > قسم > ولاية)، والباقي نفلترو فالمتصفح على الصفحة المحمّلة
function buildListingQuery(f,cursor){
  // Firestore Rules are not filters: every public search must explicitly request published ads.
  const parts=[where('status','==','published')];
  if(f.tokens.length)parts.push(where('keywords','array-contains',[...f.tokens].sort((p,q)=>q.length-p.length)[0]));
  else if(f.category)parts.push(where('category','==',f.category));
  else if(f.wilaya)parts.push(where('wilaya','==',f.wilaya));
  parts.push(orderBy('createdAt','desc'));
  if(cursor)parts.push(startAfter(cursor));
  parts.push(limit(PAGE_SIZE));
  return query(collection(db,'listings'),...parts);
}
async function loadSearchPage(reset){
  const st=searchState;
  const f=readFilters();
  if(reset){st.seq++;st.items=[];st.cursor=null;st.done=false;st.loading=false;st.key=JSON.stringify(f);st.loaded=false;}
  else if(st.done||st.loading)return;
  const seq=st.seq;
  st.loading=true;renderSearch();
  try{
    const target=st.items.length+PAGE_SIZE;let guard=0;
    while(!st.done&&st.items.length<target&&guard++<6){
      const snap=await getDocs(buildListingQuery(f,st.cursor));
      if(seq!==st.seq)return;
      cacheListings(snap.docs);
      if(snap.docs.length)st.cursor=snap.docs[snap.docs.length-1];
      if(snap.docs.length<PAGE_SIZE)st.done=true;
      st.items.push(...snap.docs.map(d=>listingMap.get(d.id)).filter(x=>matchesFilters(x,f)));
    }
    st.loaded=true;
  }catch(e){
    if(seq===st.seq){st.done=true;handleQueryError(e);}
  }finally{
    if(seq===st.seq){st.loading=false;renderSearch();}
  }
}
function renderSearch(){
  const st=searchState,f=readFilters();
  let arr=st.items.filter(x=>isVisibleListing(x));
  const sort=$('#sortResults')?.value||'new';
  if(sort==='low')arr=[...arr].sort((p,q)=>Number(p.price)-Number(q.price));
  else if(sort==='high')arr=[...arr].sort((p,q)=>Number(q.price)-Number(p.price));
  else if(sort==='views')arr=[...arr].sort((p,q)=>(q.views||0)-(p.views||0));
  const title=$('#searchTitle'),count=$('#resultCount'),btn=$('#loadMoreBtn');
  if(title)title.textContent=f.q?`نتائج: ${f.q}`:f.category||'كل الإعلانات';
  if(count)count.textContent=`${arr.length}${st.done?'':'+'} إعلان`;
  if(st.loading&&!arr.length)$('#resultsGrid').innerHTML='<div class="empty">جاري التحميل...</div>';
  else renderListings(arr,'#resultsGrid');
  if(btn){btn.hidden=st.done;btn.disabled=st.loading;btn.textContent=st.loading?'جاري التحميل...':'عرض المزيد ↓';}
}
let searchTimer=null;
function applyFilters(){
  clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>{
    if(searchState.loaded&&JSON.stringify(readFilters())===searchState.key){renderSearch();return;}
    loadSearchPage(true);
  },250);
}

// ---------- سائقون وترويجات: نحمّلوهم بقراءات محدودة ----------
async function loadDrivers(){
  try{
    const s=await getDocs(query(collection(db,'drivers'),where('status','==','approved'),where('verified','==',true),limit(40)));
    drivers=s.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){console.error(e);}
  renderDrivers();renderMyDriver();renderMyDriverDeliveries();renderTracking();renderMyDeliveries();handleDeepLink();
}
let promosLoaded=false;
async function loadPromotions(){
  if(!promosLoaded){
    try{
      const s=await getDocs(query(collection(db,'promotions'),where('status','==','approved'),limit(60)));
      promotions=s.docs.map(d=>({id:d.id,...d.data()}));promosLoaded=true;
    }catch(e){console.error(e);}
  }
  renderPromotions();
}

function renderListings(items,target){
  const el=$(target);if(!el)return;
  el.innerHTML=items.length?items.map(card).join(''):'<div class="empty">ما لقيناش إعلانات مطابقة.</div>';
  $$(target+' .heart').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleFavorite(b.dataset.fav);});
  $$(target+' .listing').forEach(c=>c.onclick=()=>openListing(c.dataset.id));
}

async function toggleFavorite(id){
  if(!requireLogin())return;
  const isFav=favorites.includes(id);
  try{
    await updateDoc(doc(db,'users',currentUser.uid),{
      favoriteIds: isFav?arrayRemove(id):arrayUnion(id),
      updatedAt:serverTimestamp()
    });
    favorites = isFav?favorites.filter(f=>f!==id):[...favorites,id];
    renderAll();
    if($('#listingModal').hidden===false)refreshModalFavoriteBtn(id);
    toast(isFav?'تمت الإزالة من المفضلة':'تمت الإضافة للمفضلة ❤️');
  }catch(e){toast('تعذر تحديث المفضلة.');}
}

function refreshModalFavoriteBtn(id){
  const btn=$('#modalFavoriteBtn');if(!btn)return;
  btn.textContent=favorites.includes(id)?'♥ محفوظ':'♡ حفظ';
}



// ----- FIX: لا نزيد المشاهدات إذا صاحب الإعلان يشوف إعلانه بنفسو -----
async function openListing(id){
  const x=listings.find(i=>String(i.id)===String(id));if(!x)return;
  const owner=x.ownerUid,current=owner===currentUser?.uid;
  const seenKey='viewed_'+id;
  if(currentUser&&!current&&!sessionStorage.getItem(seenKey)){
    sessionStorage.setItem(seenKey,'1');
    try{
      const vb=writeBatch(db);
      vb.set(doc(db,'listings',id,'viewers',currentUser.uid),{createdAt:serverTimestamp()});
      vb.update(doc(db,'listings',id),{views:increment(1),updatedAt:serverTimestamp()});
      await vb.commit();
    }catch{}
  }
  const allImages=x.images?.length?x.images:(x.image?[x.image]:[]);
  const rating=x.ratingCount?(x.ratingSum/x.ratingCount).toFixed(1):null;
  const gallery=galleryHtml(allImages);
  $('#modalContent').innerHTML=`${gallery}
    <div class="meta">${escapeHtml(x.category)} • ${escapeHtml(x.condition)} • 👁️ ${x.views||0} مشاهدة ${rating?`• ⭐ ${rating} (${x.ratingCount})`:''}</div>
    <h2>${escapeHtml(x.title)}</h2><div class="detail-price">${formatPrice(x.price)}</div>
    <div class="meta">📍 ${escapeHtml(x.wilaya)}${x.city?(' - '+escapeHtml(x.city)):''} • 👤 ${escapeHtml(x.seller||'بائع')}${x.sellerVerified?' <span class="verified">✓</span>':''}</div>
    <p style="margin-top:10px;line-height:1.7">${escapeHtml(x.description||'')}</p>
    <div id="phoneSlot"></div>
    <div class="notice">⚠️ سوق الجزائر وسيط فقط ولا يضمن المعاملات. لا تدفع مسبقاً، وتأكد من السلعة قبل الدفع.</div>
    ${x.status==='hidden'?'<div class="notice notice-warning">🙈 هذا الإعلان أخفته الإدارة بعد الفحص، ما يظهرش للعموم.</div>':''}
    <div class="detail-actions">
      ${!current?'<button class="primary" id="messageSellerBtn">💬 مراسلة البائع</button>':''}
      ${!current&&x.delivery?'<button class="secondary" id="requestDeliveryBtn">🚚 اطلب توصيل</button>':''}
      ${!current?'<button class="secondary" id="rateSellerBtn">⭐ قيّم البائع</button>':''}
      ${!current?'<button class="secondary" id="reportListingBtn">🚩 تبليغ</button>':''}
      <button class="secondary" id="modalFavoriteBtn">${favorites.includes(x.id)?'♥ محفوظ':'♡ حفظ'}</button>
      <button class="secondary" id="shareListingBtn">🔗 مشاركة</button>
      ${current?'<button class="secondary danger-btn" id="deleteListingBtn">🗑️ حذف إعلاني</button>':''}
    </div>`;
  $('#shareListingBtn').onclick=()=>shareLink({title:x.title,text:`${x.title} - ${formatPrice(x.price)} على سوق الجزائر`,url:listingUrl(x.id)});
  if(current)$('#deleteListingBtn').onclick=()=>deleteMyListing(x.id);
  if(!current){
    $('#messageSellerBtn').onclick=()=>openConversationWith(owner,x);
    $('#reportListingBtn').onclick=()=>openReport('listing',x.id);
    $('#rateSellerBtn').onclick=()=>openRating(owner,x.id);
    if(x.delivery)$('#requestDeliveryBtn').onclick=()=>openDeliveryRequest(x);
  }
  $('#modalFavoriteBtn').onclick=()=>toggleFavorite(x.id);
  $('#listingModal').hidden=false;
  loadListingPhone(x);
  $$('#modalContent .gal').forEach(g=>initSlider(g));
}

function phoneHtml(p){const e=escapeHtml(p);return `<div class="phone-box"><b>📞 ${e}</b> <a class="small-btn" href="tel:${e}">اتصال</a> <a class="small-btn success" target="_blank" rel="noopener" href="${escapeHtml(waLink(p))}">🟢 واتساب</a></div>`;}
// الهاتف ما عادش فـ وثيقة الإعلان العامة: نجيبوه من وثيقة خاصة (للمسجّلين فقط)
async function loadListingPhone(x){
  const slot=$('#phoneSlot');if(!slot)return;
  if(x.phone&&x.showPhone){slot.innerHTML=phoneHtml(x.phone);return;} // إعلانات قديمة قبل النقل
  if(!x.hasPhone)return;
  if(!currentUser){slot.innerHTML='<div class="notice">🔒 سجّل الدخول لعرض رقم الهاتف.</div>';return;}
  try{const s=await getDoc(doc(db,'listings',x.id,'private','contact'));if(s.exists()&&s.data().phone&&s.data().showPhone)slot.innerHTML=phoneHtml(s.data().phone);}catch{}
}


// ---------- معرض الصور + السلايدر (سحب بالإصبع، أسهم، نقاط، مصغّرات) ----------
function galleryHtml(imgs){
  const n=imgs.length;if(!n)return'<div class="gallery-main">🛍️</div>';
  return`<div class="gal"><div class="gal-track">${imgs.map(u=>`<div class="gal-slide"><img src="${escapeHtml(cloudinaryUrl(u,1000,800))}" alt="" loading="lazy"></div>`).join('')}</div>${n>1?`<button type="button" class="gal-btn gal-prev" aria-label="السابق">›</button><button type="button" class="gal-btn gal-next" aria-label="التالي">‹</button><span class="gal-count">1/${n}</span>`:''}</div>${n>1?`<div class="gal-thumbs">${imgs.map((u,i)=>`<button type="button" class="gal-thumb${i?'':' on'}"><img src="${escapeHtml(cloudinaryUrl(u,120,120))}" alt=""></button>`).join('')}</div>`:''}`;
}
function initSlider(root,auto=0){
  const tr=root.querySelector('.gal-track');if(!tr)return;
  const n=tr.children.length,cnt=root.querySelector('.gal-count'),dots=root.querySelectorAll('.gal-dot'),thumbs=root.parentNode.querySelectorAll('.gal-thumb');
  const sign=getComputedStyle(root).direction==='rtl'?1:-1;let i=0,timer=null,x0=null;
  const go=k=>{i=(k+n)%n;tr.style.transform=`translateX(${sign*i*100}%)`;if(cnt)cnt.textContent=`${i+1}/${n}`;dots.forEach((d,j)=>d.classList.toggle('on',j===i));thumbs.forEach((t,j)=>t.classList.toggle('on',j===i));};
  const stop=()=>{clearInterval(timer);timer=null;};
  const start=()=>{stop();if(auto&&n>1)timer=setInterval(()=>{if(!root.isConnected)return stop();go(i+1);},auto);};
  const hit=(el,k)=>el?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();go(k());});
  hit(root.querySelector('.gal-next'),()=>i+1);hit(root.querySelector('.gal-prev'),()=>i-1);
  dots.forEach((d,j)=>hit(d,()=>j));thumbs.forEach((t,j)=>t.addEventListener('click',()=>go(j)));
  root.addEventListener('touchstart',e=>{x0=e.touches[0].clientX;stop();},{passive:true});
  root.addEventListener('touchend',e=>{if(x0!==null){const dx=e.changedTouches[0].clientX-x0;if(Math.abs(dx)>40)go(i+(dx*sign>0?1:-1));}x0=null;start();});
  root.addEventListener('mouseenter',stop);root.addEventListener('mouseleave',start);start();
}
// ---------- الترويجات فـ المقدمة (شريط إعلانات متحرك) ----------
// نحجزو مكان الشريط قبل ما يوصل من Firestore (يقلّل CLS): إذا كان فيه ترويج فـ الزيارة اللي فاتت
(()=>{try{if(localStorage.getItem('souq_hadPromo')==='1'){const el=document.querySelector('#promoHero');if(el&&!el.innerHTML){el.hidden=false;el.innerHTML='<div class="gal promo-gal"><div class="gal-slide promo-slide"></div></div>';}}}catch{}})();
function renderPromoHero(){
  const el=$('#promoHero');if(!el)return;
  const ps=promotions.filter(p=>p.status==='approved').sort((a,b)=>(b.image?1:0)-(a.image?1:0)).slice(0,8);
  if(!ps.length){el.hidden=true;el.innerHTML='';try{localStorage.setItem('souq_hadPromo','0');}catch{}return;}
  try{localStorage.setItem('souq_hadPromo','1');}catch{}
  const slide=p=>{const u=safeUrl(p.url),inner=`${p.image?`<img src="${escapeHtml(cloudinaryUrl(p.image,900,420))}" alt="">`:'<div class="promo-ph">📣</div>'}<div class="promo-cap"><span class="promo-badge">ترويج</span><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.type||'')}${p.wilaya?' • 📍 '+escapeHtml(p.wilaya):''}</small></div>`;
    return u?`<a class="gal-slide promo-slide" href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer sponsored">${inner}</a>`:`<div class="gal-slide promo-slide">${inner}</div>`;};
  el.hidden=false;
  el.innerHTML=`<div class="gal promo-gal"><div class="gal-track">${ps.map(slide).join('')}</div>${ps.length>1?`<button type="button" class="gal-btn gal-prev" aria-label="السابق">›</button><button type="button" class="gal-btn gal-next" aria-label="التالي">‹</button><div class="gal-dots">${ps.map((_,k)=>`<i class="gal-dot${k?'':' on'}"></i>`).join('')}</div>`:''}</div>`;
  initSlider(el.firstElementChild,5000);
}

function closeModal(){$('#listingModal').hidden=true;}

async function submitListing(e){
  e.preventDefault();if(!requireLogin())return;
  if(currentProfile?.banned){toast('🚫 حسابك موقوف، لا يمكنك النشر.');return;}
  const f=new FormData(e.target),title=String(f.get('title')||'').trim(),price=Number(f.get('price'));
  if(f.get('website'))return; // honeypot: البوتات تعمّر هذا الحقل المخفي
  const images=collectImageUrls();
  const screen=screenListing({title,description:String(f.get('description')||''),price,phone:String(f.get('phone')||'').trim(),images});
  if(screen.blocked){toast('⚠️ المحتوى يحتوي على كلمات ممنوعة.');return;}
  if(isDuplicatePost(title,currentUser.uid)){toast('⚠️ عندك إعلان بنفس العنوان نشرته قريب. تفادى التكرار.');return;}
  const flagged=screen.score>=40;
  const item={
    title,price,category:f.get('category'),wilaya:f.get('wilaya'),city:String(f.get('city')||'').trim(),
    condition:f.get('condition'),delivery:f.get('delivery')!=='يد بيد',
    images,image:images[0]||'',emoji:'🛍️',
    seller:currentProfile?.displayName||currentUser.displayName||'بائع',
    sellerVerified:currentProfile?.verified||false,ownerUid:currentUser.uid,
    description:String(f.get('description')||'').trim(),hasPhone:!!String(f.get('phone')||'').trim()&&f.get('showPhone')!==null,
    status:'published',
    flagged, flagReason:screen.reasons.join('، '), aiScore:screen.score,
    keywords:buildKeywords({title,category:f.get('category'),wilaya:f.get('wilaya'),city:f.get('city')}),
    views:0,ratingCount:0,ratingSum:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  };
  try{
    showLoading(true);
    // حصة النشر: فاصل 60 ثانية + 20 إعلان كل 24 ساعة. القواعد تتحقق منها، وهنا نتأكدو قبل لتجنّب رسالة خطأ غامضة.
    const lref=doc(collection(db,'listings')),qref=doc(db,'listingQuota',currentUser.uid);
    const qs=await getDoc(qref),nowMs=Date.now();
    let quota={count:1,windowStart:serverTimestamp()};
    if(qs.exists()){
      const q=qs.data(),lastMs=q.lastAt?.toMillis?.()||0,startMs=q.windowStart?.toMillis?.()||0;
      if(nowMs-lastMs<60000){toast(`⏳ انتظر ${Math.ceil((60000-(nowMs-lastMs))/1000)} ثانية قبل نشر إعلان جديد.`);return;}
      if(nowMs-startMs<24*3600*1000){
        if(q.count>=20){toast('🚫 وصلت الحد اليومي (20 إعلان). حاول غداً.');return;}
        quota={count:q.count+1,windowStart:q.windowStart};
      }
    }
    quota.lastAt=serverTimestamp();quota.lastListingId=lref.id;
    const batch=writeBatch(db);
    batch.set(lref,item);
    batch.set(doc(db,'listings',lref.id,'private','contact'),{phone:String(f.get('phone')||'').trim().slice(0,20),showPhone:f.get('showPhone')!==null,ownerUid:currentUser.uid});
    batch.set(qref,quota);
    await batch.commit();
    e.target.reset();currentImages=[];renderImagePreview();
    searchState.key='';myListingsLoaded=false;
    loadHome();loadMyListings(true);
    toast('تم نشر الإعلان مباشرة ✅');
    go('home');
  }catch(err){toast(err.code==='permission-denied'?'تعذر النشر: تأكد من الفاصل الزمني (60 ثانية) أو من حالة حسابك.':'فشل نشر الإعلان: '+(err.code||err.message));}
  finally{showLoading(false);}
}

async function submitDriver(e){
  e.preventDefault();if(!requireLogin())return;
  if(currentProfile?.banned){toast('🚫 حسابك موقوف.');return;}
  if(myDriver){toast(myDriver.status==='pending'?'عندك طلب موصّل قيد المراجعة بالفعل ⏳':'عندك حساب موصّل مسجّل بالفعل 🚚');return;}
  // تاريخ الميلاد نستعملوه فقط للتأكد من 18+ فالمتصفح، وما نخزّنوهش
  const f=new FormData(e.target),birth=new Date(f.get('birth')),age=(Date.now()-birth.getTime())/(365.25*24*3600*1000);
  if(f.get('website'))return;
  if(!(age>=18)){toast('لازم تكون 18 سنة أو أكثر');return;}
  const fbRaw=String(f.get('facebook')||'').trim(),fb=fbRaw?safeUrl(fbRaw):'';
  if(fbRaw&&!fb){toast('رابط الفايسبوك غير صحيح (لازم يبدأ بـ https://)');return;}
  try{
    showLoading(true);
    const item={ownerUid:currentUser.uid,name:String(f.get('name')||'').trim(),phone:String(f.get('phone')||'').trim(),facebook:fb,wilaya:f.get('wilaya'),vehicle:f.get('vehicle'),vehicleNumber:String(f.get('vehicleNumber')||'').trim(),status:'pending',verified:false,activityStatus:'offline',lastSeenAt:serverTimestamp(),rating:null,rides:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
    await addDoc(collection(db,'drivers'),item);
    e.target.reset();toast('تم إرسال طلب المراجعة 🛡️');
  }catch(err){toast(err.message||'فشل إرسال الطلب');}
  finally{showLoading(false);}
}

function driverActionsHtml(d){return`
    <div class="driver-phone"><a href="tel:${escapeHtml(d.phone||'')}">📞 ${escapeHtml(d.phone||'—')}</a></div>
    <div class="driver-actions">
      <a class="small-btn" href="tel:${escapeHtml(d.phone||'')}">📞 اتصال</a>
      <a class="small-btn success" target="_blank" rel="noopener" href="${escapeHtml(waLink(d.phone,'السلام عليكم، جيتك من سوق الجزائر بخصوص التوصيل'))}">🟢 واتساب</a>
      ${safeUrl(d.facebook)?`<a class="small-btn" target="_blank" rel="noopener noreferrer" href="${escapeHtml(safeUrl(d.facebook))}">🔵 فايسبوك</a>`:''}
      ${d.ownerUid&&d.ownerUid!==currentUser?.uid?`<button class="small-btn" data-driver-chat="${escapeHtml(d.id)}">💬 دردشة</button>`:''}
      <button class="small-btn" data-driver-share="${escapeHtml(d.id)}">🔗 مشاركة</button>
    </div>`;}
function driverNear(d){const w=$('#driverWilayaFilter')?.value||currentProfile?.wilaya||'';return !!w&&d.wilaya===w;}
function driverAvg(d){return d.ratingCount?d.ratingSum/d.ratingCount:0;}
function ratingChipHtml(d){
  const n=d.ratingCount||0;
  return n?`<span class="drv-rate">⭐ ${driverAvg(d).toFixed(1)} <small>(${n})</small></span>`:'<span class="drv-rate none">جديد • بدون تقييم</span>';
}
function driverCard(d){
  const st=statusMeta(d),ini=escapeHtml((d.name||'م').trim().charAt(0));
  return`<article class="driver driver-pro" id="driver-${escapeHtml(d.id)}" data-driver-open="${escapeHtml(d.id)}" tabindex="0" role="button" aria-label="${escapeHtml(d.name||'موصّل')}"><div class="driver-avatar ${st.s}">${ini}</div><div class="driver-info"><h3>${escapeHtml(d.name||'موصّل')} ${d.verified?'<span class="verified">✓</span>':''}</h3><div class="meta">🚗 ${escapeHtml(d.vehicle||'مركبة')} • 📍 ${escapeHtml(d.wilaya||'')}</div>${ratingChipHtml(d)}<div class="activity-label">🕒 ${escapeHtml(st.lastSeen)}</div></div><div class="driver-side"><span class="status-dot ${st.s}">${st.label}</span>${driverNear(d)?'<span class="near-badge">📍 الأقرب لك</span>':''}<span class="driver-more">التفاصيل ‹</span></div></article>`;
}
let openDriverId=null;
function closeDriverModal(){const m=$('#driverModal');if(m)m.hidden=true;openDriverId=null;}
function openDriverModal(id){
  const d=drivers.find(z=>z.id===id);if(!d)return;
  let m=$('#driverModal');
  if(!m){m=document.createElement('div');m.id='driverModal';m.className='modal';m.hidden=true;
    m.innerHTML='<div class="modal-backdrop" data-close></div><div class="modal-card modal-large"><button class="modal-close" data-close aria-label="إغلاق">×</button><div id="driverModalBody"></div></div>';
    document.body.appendChild(m);
    m.onclick=ev=>{
      if(ev.target.closest('[data-close]')){closeDriverModal();return;}
      const dd=drivers.find(z=>z.id===openDriverId);if(!dd)return;
      if(ev.target.closest('[data-driver-chat]')){closeDriverModal();openConversationWith(dd.ownerUid,{id:'driver_'+dd.id,title:'🚚 موصّل: '+(dd.name||''),seller:dd.name});}
      else if(ev.target.closest('[data-driver-share]'))shareLink({title:'موصّل على سوق الجزائر',text:`${dd.name} - موصّل فـ${dd.wilaya} 📞 ${dd.phone}`,url:driverUrl(dd.id)});
      else if(ev.target.closest('[data-driver-rate]'))openDriverRating(dd.id);
      else if(ev.target.closest('[data-driver-report]'))openReport('driver',dd.id);
    };}
  openDriverId=id;renderDriverModalBody(d);
  m.hidden=false;loadDriverReviews(id);
}
function renderDriverModalBody(d){
  const st=statusMeta(d),own=d.ownerUid===currentUser?.uid,n=d.ratingCount||0,avg=driverAvg(d),full=Math.round(avg);
  const fact=(l,v)=>`<div><small>${l}</small><b>${v}</b></div>`;
  $('#driverModalBody').innerHTML=`<div class="driver-hero"><div class="driver-avatar big ${st.s}">${escapeHtml((d.name||'م').trim().charAt(0))}</div><div><h2>${escapeHtml(d.name||'موصّل')} ${d.verified?'<span class="verified">✓</span>':''}</h2><span class="status-dot ${st.s}">${st.label}</span></div></div>
    <div class="dm-rating">${n?`<b class="dm-score">${avg.toFixed(1)}</b><span class="stars">${'★'.repeat(full)}${'☆'.repeat(5-full)}</span><span class="meta">${n} تقييم</span>`:'<span class="meta">⭐ ما كاش تقييمات بعد</span>'}</div>
    <div class="driver-facts">${fact('المركبة',escapeHtml(d.vehicle||'—'))}${fact('الولاية',escapeHtml(d.wilaya||'—'))}${fact('التوصيلات',escapeHtml(String(d.rides||0)))}${fact('التقييم',n?'⭐ '+avg.toFixed(1):'—')}</div>
    <div class="activity-label">🕒 ${escapeHtml(st.lastSeen)}</div>${driverActionsHtml(d)}
    ${own?'':'<div class="driver-actions"><button class="primary" data-driver-rate>⭐ قيّم هذا الموصّل</button><button class="small-btn" data-driver-report>🚩 تبليغ</button></div>'}
    <div class="notice">⚠️ سوق الجزائر وسيط فقط. اتفق على السعر قبل التوصيل ولا تدفع مسبقاً.</div>
    <h3 class="dm-sub">آراء الزبائن</h3>
    <div id="driverReviews" class="review-list"><div class="empty small-empty">جاري التحميل...</div></div>`;
}
async function loadDriverReviews(id){
  const el=$('#driverReviews');if(!el)return;
  try{
    const s=await getDocs(query(collection(db,'drivers',id,'reviews'),orderBy('createdAt','desc'),limit(20)));
    if(openDriverId!==id)return;
    const rows=s.docs.map(x=>x.data());
    el.innerHTML=rows.length?rows.map(r=>{
      const k=Math.max(1,Math.min(5,Number(r.rating)||1));
      const dt=r.createdAt?.seconds?new Date(r.createdAt.seconds*1000).toLocaleDateString('ar-DZ'):'';
      return`<div class="review"><div class="review-top"><b>${escapeHtml(r.raterName||'مستخدم')}</b><span class="stars">${'★'.repeat(k)}${'☆'.repeat(5-k)}</span></div>${r.comment?`<p>${escapeHtml(r.comment)}</p>`:''}<small class="muted">${escapeHtml(dt)}</small></div>`;
    }).join(''):'<div class="empty small-empty">ما كاش آراء بعد. كون أول واحد يقيّم! ⭐</div>';
  }catch(e){console.error(e);if(openDriverId===id)el.innerHTML='<div class="empty small-empty">تعذر تحميل الآراء.</div>';}
}
function openDriverRating(id){
  if(!requireLogin())return;
  const d=drivers.find(z=>z.id===id);
  if(d&&d.ownerUid===currentUser.uid){toast('ما تقدرش تقيّم روحك');return;}
  ratingTarget={kind:'driver',driverId:id};
  $('#ratingTitle').textContent='⭐ تقييم الموصّل';
  $('#ratingValue').value='';
  $$('#starRating button').forEach(b=>b.classList.remove('active'));
  $('#ratingModal').hidden=false;
}
async function submitDriverRating(val,comment,form){
  const id=ratingTarget.driverId,d=drivers.find(z=>z.id===id);
  if(!d)return;
  try{
    showLoading(true);
    const b=writeBatch(db);
    b.set(doc(db,'drivers',id,'reviews',currentUser.uid),{raterUid:currentUser.uid,raterName:currentProfile?.displayName||currentUser.displayName||'مستخدم',rating:val,comment,createdAt:serverTimestamp()});
    b.update(doc(db,'drivers',id),{ratingSum:increment(val),ratingCount:increment(1)});
    await b.commit();
    d.ratingSum=(d.ratingSum||0)+val;d.ratingCount=(d.ratingCount||0)+1;
    toast('شكراً على تقييمك ⭐');
    $('#ratingModal').hidden=true;form.reset();
    renderDrivers();
    if(openDriverId===id){renderDriverModalBody(d);loadDriverReviews(id);}
  }catch(err){
    toast(err.code==='permission-denied'?'قيّمت هذا الموصّل من قبل ⭐':'تعذر إرسال التقييم');
  }finally{showLoading(false);}
}
function renderDrivers(){
  const el=$('#driverGrid');if(!el)return;
  let f=$('#driverWilayaFilter');
  if(!f){f=document.createElement('select');f.id='driverWilayaFilter';f.className='driver-filter';f.setAttribute('aria-label','ولايتك');
    f.innerHTML='<option value="">📍 الأقرب إليّ (حسب ولايتي)</option>'+wilayas.map(w=>`<option value="${escapeHtml(w)}">${escapeHtml(w)}</option>`).join('');
    el.parentNode.insertBefore(f,el);f.onchange=renderDrivers;}
  const score=d=>(driverNear(d)?2:0)+(d.activityStatus==='active'?1:0);
  const approved=drivers.filter(d=>d.status==='approved'&&d.verified).sort((x,y)=>score(y)-score(x)||driverAvg(y)-driverAvg(x));
  el.innerHTML=approved.length?approved.map(driverCard).join(''):'<div class="empty">ما كاش موصلين حالياً.</div>';
  const open=ev=>{const c=ev.target.closest('[data-driver-open]');if(c)openDriverModal(c.dataset.driverOpen);};
  el.onclick=open;el.onkeydown=ev=>{if(ev.key==='Enter'&&ev.target.dataset?.driverOpen)openDriverModal(ev.target.dataset.driverOpen);};
  const homeEl=$('#homeDrivers');
  if(homeEl){const act=approved.filter(d=>d.activityStatus==='active').slice(0,4);homeEl.innerHTML=act.length?act.map(driverCard).join(''):'<div class="empty">ما كاش موصلين نشطين.</div>';homeEl.onclick=open;}
}

async function setDriverStatus(status){
  if(!myDriver||!requireLogin())return;
  try{await updateDoc(doc(db,'drivers',myDriver.id),{activityStatus:status,lastSeenAt:serverTimestamp()});toast('تم تغيير الحالة ✅');}catch(e){toast('تعذر تغيير الحالة');}
}

function renderMyDriver(){
  const el=$('#myDriverStatus');if(!el)return;
  if(!myDriver||myDriver.status!=='approved'||!myDriver.verified){el.hidden=true;return;}
  el.hidden=false;const st=statusMeta(myDriver);
  el.innerHTML=`<div class="status-line"><b>حالتك:</b><span class="status-dot ${st.s}">${st.label}</span></div>
  <div class="driver-status-actions"><button class="small-btn" data-status="active">🟢 متصل الآن</button><button class="small-btn" data-status="busy">🟠 مشغول</button><button class="small-btn" data-status="offline">⚫ غير متصل</button></div>`;
  $$('[data-status]').forEach(b=>b.onclick=()=>setDriverStatus(b.dataset.status));
}

async function loginGoogle(){
  try{
    await signInWithPopup(auth, googleProvider);
  }catch(e){
    if(e.code!=='auth/popup-closed-by-user')toast('تعذر تسجيل الدخول: '+e.code);
  }
}

async function submitReport(e){
  e.preventDefault();if(!requireLogin())return;
  if(!cdCheck('report',20000,'⏳ انتظر شوية قبل بلاغ جديد.'))return;
  try{
    await setDoc(doc(db,'reports',currentUser.uid+'_'+$('#reportTargetType').value+'_'+$('#reportTargetId').value),{reporterUid:currentUser.uid,reporterName:currentProfile?.displayName||currentUser.displayName||'مستخدم',targetType:$('#reportTargetType').value,targetId:$('#reportTargetId').value,reason:$('#reportReason').value,details:$('#reportDetails').value.trim(),status:'open',createdAt:serverTimestamp()});
    toast('تم إرسال البلاغ 🚩');closeReport();e.target.reset();
  }catch(e){toast('تعذر إرسال البلاغ');}
}

function openReport(type,id){if(!requireLogin())return;$('#reportTargetId').value=id;$('#reportTargetType').value=type;$('#reportModal').hidden=false;}
function closeReport(){$('#reportModal').hidden=true;}

async function submitPromotion(e){
  e.preventDefault();if(!requireLogin())return;
  const f=new FormData(e.target);
  if(f.get('website'))return;
  if(!cdCheck('promo',60000,'⏳ انتظر دقيقة قبل ترويج جديد.'))return;
  const spam=analyzeSpam(String(f.get('name')||'')+' '+String(f.get('description')||''));
  if(spam.blocked){toast('⚠️ المحتوى يحتوي على كلمات ممنوعة.');return;}
  let imageUrl='';
  const file=$('#promoImageInput');
  try{
    showLoading(true);
    if(file?.files.length){imageUrl=await uploadImageToCloudinary(file.files[0],'souq-algeria/promotions');}
    const item={ownerUid:currentUser.uid,name:String(f.get('name')||'').trim(),type:f.get('type'),wilaya:f.get('wilaya'),url:safeUrl(String(f.get('url')||'').trim()),description:String(f.get('description')||'').trim(),image:imageUrl,status:'pending',createdAt:serverTimestamp()};
    await addDoc(collection(db,'promotions'),item);
    e.target.reset();toast('تم إرسال الترويج، بانتظار المراجعة 📣');
  }catch(err){toast('فشل إرسال الترويج');}
  finally{showLoading(false);}
}

function renderPromotions(){
  renderPromoHero();
  const el=$('#promoGrid');if(!el)return;
  const approved=promotions.filter(p=>p.status==='approved');
  el.innerHTML=approved.length?approved.map(p=>`<div class="promo-card">${p.image?`<img src="${escapeHtml(cloudinaryUrl(p.image,200,200))}" alt="">`:'📣'}<h3>${escapeHtml(p.name)}</h3><div class="meta">${escapeHtml(p.type)}</div>${safeUrl(p.url)?`<a href="${escapeHtml(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">زيارة الرابط ↗</a>`:''}</div>`).join(''):'<div class="empty">ما كاش ترويجات بعد.</div>';
}

// ----- Contact / share helpers -----
function normalizeDzPhone(p){let s=String(p||'').replace(/[^\d+]/g,'');if(s.startsWith('+'))s=s.slice(1);if(s.startsWith('00'))s=s.slice(2);if(s.startsWith('213'))return s;if(s.startsWith('0'))return '213'+s.slice(1);return '213'+s;}
function waLink(p,text=''){return `https://wa.me/${normalizeDzPhone(p)}${text?('?text='+encodeURIComponent(text)):''}`;}
function safeUrl(u){try{const x=new URL(String(u||'').trim());return(x.protocol==='https:'||x.protocol==='http:')?x.href:'';}catch{return'';}}
async function shareLink({title,text,url}){
  try{
    if(navigator.share){await navigator.share({title,text,url});return;}
    await navigator.clipboard.writeText(url);toast('تم نسخ الرابط 📋');
  }catch(e){
    if(e?.name==='AbortError')return;
    try{await navigator.clipboard.writeText(url);toast('تم نسخ الرابط 📋');}catch{toast('تعذرت المشاركة');}
  }
}
// رابط الإعلان للمشاركة = صفحة ثابتة (معاينة واتساب/فيسبوك + فهرسة جوجل). إذا ما تولّدتش بعد، 404.html يحوّل للتطبيق.
function listingUrl(id){const base=location.origin+location.pathname.replace(/[^/]*$/,'');return /^[A-Za-z0-9_-]{1,128}$/.test(id)?`${base}l/${id}.html`:`${base}?view=listing&id=${encodeURIComponent(id)}`;}
function driverUrl(id){return `${location.origin}${location.pathname}?view=driver&id=${encodeURIComponent(id)}`;}

async function deleteMyListing(id){
  if(!requireLogin())return;
  const x=listings.find(i=>i.id===id);
  if(!x||x.ownerUid!==currentUser.uid){toast('ما تقدرش تحذف هذا الإعلان.');return;}
  if(!confirm('واش متأكد تحب تحذف هذا الإعلان نهائياً؟'))return;
  try{showLoading(true);await deleteDoc(doc(db,'listings',id));forgetListing(id);closeModal();toast('تم حذف الإعلان 🗑️');}
  catch(e){toast('تعذر حذف الإعلان');}
  finally{showLoading(false);}
}
async function deleteMyDelivery(id){
  if(!requireLogin())return;
  if(!confirm('واش تحب تحذف طلب التوصيل هذا؟'))return;
  try{showLoading(true);await deleteDoc(doc(db,'deliveryRequests',id));toast('تم حذف طلب التوصيل 🗑️');}
  catch(e){toast('ما تقدرش تحذف الطلب فهاذ المرحلة (مثلاً وهو قيد التوصيل).');}
  finally{showLoading(false);}
}

// ----- Delivery request (بلا وثائق هوية: المنصة وسيط فقط) -----
function openDeliveryRequest(listing){
  if(!requireLogin())return;
  pendingLocation=null;
  $('#deliveryReqLocationLabel').textContent='';
  $('#deliveryRequestForm').reset();
  $('#deliveryReqListingId').value=listing.id;
  $('#deliveryRequestModal').hidden=false;
}
function closeDeliveryRequest(){$('#deliveryRequestModal').hidden=true;}

function initDeliveryRequestForm(){
  $('#useMyLocationBtn').onclick=()=>{
    if(!navigator.geolocation){toast('المتصفح ما يدعمش تحديد الموقع.');return;}
    navigator.geolocation.getCurrentPosition(pos=>{
      pendingLocation={lat:pos.coords.latitude,lng:pos.coords.longitude};
      $('#deliveryReqLocationLabel').textContent='📍 تم تسجيل موقعك الحالي.';
      toast('تم تحديد الموقع ✅');
    },()=>{toast('تعذر الوصول للموقع.');});
  };
  $('#deliveryRequestForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!requireLogin())return;
    if(currentProfile?.banned){toast('🚫 حسابك موقوف.');return;}
    if(!cdCheck('delivery',60000,'⏳ انتظر دقيقة قبل طلب توصيل جديد.'))return;
    const f=new FormData(e.target);
    const listingId=$('#deliveryReqListingId').value;
    const listing=listings.find(l=>l.id===listingId);
    if(!listing){toast('الإعلان غير موجود.');return;}
    try{
      showLoading(true);
      const item={
        listingId, listingTitle:listing.title, sellerUid:listing.ownerUid,
        buyerUid:currentUser.uid, buyerName:String(f.get('fullName')||'').trim(),
        phone:String(f.get('phone')||'').trim(), wilaya:f.get('wilaya'), city:String(f.get('city')||'').trim(),
        address:String(f.get('address')||'').trim(),
        location:pendingLocation, driverId:null,
        status:'pending', createdAt:serverTimestamp(), updatedAt:serverTimestamp()
      };
      const requestRef=await addDoc(collection(db,'deliveryRequests'),item);
      try{await setDoc(doc(db,'notifications',requestRef.id+'_seller'),{toUserId:listing.ownerUid,fromUserId:currentUser.uid,type:'delivery',title:'طلب توصيل جديد',body:`طلب توصيل لإعلان: ${listing.title}`.slice(0,180),deliveryRequestId:requestRef.id,read:false,createdAt:serverTimestamp()});}catch(notifyError){console.warn('Delivery notification:',notifyError);}
      closeDeliveryRequest();closeModal();
      toast('تم إرسال طلب التوصيل، الإدارة بصدد مراجعته 🚚');
    }catch(err){toast(err.message||'فشل إرسال طلب التوصيل');}
    finally{showLoading(false);}
  });
}

const DELIVERY_STATUS_LABEL={
  pending:'⏳ بانتظار موافقة الإدارة', pending_review:'⏳ بانتظار موافقة الإدارة', approved:'✅ تمت الموافقة، بانتظار موصّل',
  assigned:'🚚 تم تعيين موصّل', picked_up:'📦 تم الاستلام', delivering:'🚗 في الطريق',
  completed:'✅ تم التسليم', rejected:'❌ مرفوض', cancelled:'✖️ ملغى'
};

// معلومات الموصّل: نفضّلو النسخة المنسوخة فـالطلب، ونرجعو لقائمة الموصلين كاحتياط
function driverFromRequest(r){
  if(!r.driverId)return null;
  const pub=drivers.find(d=>d.id===r.driverId)||{};
  return{...pub,name:r.driverName||pub.name,phone:r.driverPhone||pub.phone,facebook:r.driverFacebook||pub.facebook,
    ownerUid:r.driverUid||pub.ownerUid,id:r.driverId};
}
function driverContactHtml(d,r){
  return `<div class="driver-actions" style="margin-top:8px">
    ${d.phone?`<a class="small-btn" href="tel:${escapeHtml(d.phone)}">📞 اتصال</a><a class="small-btn success" target="_blank" rel="noopener" href="${escapeHtml(waLink(d.phone))}">🟢 واتساب</a>`:''}
    ${safeUrl(d.facebook)?`<a class="small-btn" target="_blank" rel="noopener noreferrer" href="${escapeHtml(safeUrl(d.facebook))}">🔵 فايسبوك</a>`:''}
    ${d.ownerUid?`<button class="small-btn" data-driver-chat-req="${escapeHtml(r.id)}">💬 دردشة</button>`:''}
  </div>`;
}
const DELETABLE_DELIVERY=['pending','pending_review','approved','rejected','cancelled','completed'];
function bindDeliveryButtons(root){
  root.querySelectorAll('[data-del-delivery]').forEach(b=>b.onclick=()=>deleteMyDelivery(b.dataset.delDelivery));
  root.querySelectorAll('[data-driver-chat-req]').forEach(b=>b.onclick=()=>{
    const r=deliveryRequests.find(z=>z.id===b.dataset.driverChatReq);const d=r&&driverFromRequest(r);
    if(d?.ownerUid)openConversationWith(d.ownerUid,{id:'driver_'+d.id,title:'🚚 موصّل: '+(d.name||''),seller:d.name});
  });
}
function renderTracking(){
  const el=$('#trackingList');if(!el)return;
  const mine=deliveryRequests.filter(r=>r.buyerUid===currentUser?.uid);
  if(!mine.length){el.innerHTML='<div class="empty">ما كاش طلبات توصيل.</div>';return;}
  el.innerHTML=mine.map(r=>{
    const driver = driverFromRequest(r);
    const driverInfo = driver ? `
      <div style="margin-top:10px;padding:10px;background:var(--primary-light);border-radius:8px">
        <div class="meta">🚚 الموصّل: <b>${escapeHtml(driver.name||'موصّل')}</b> ${driver.verified?'<span class="verified">✓</span>':''}</div>
        ${driver.phone ? `<div class="meta">📞 الهاتف: <a href="tel:${escapeHtml(driver.phone)}" style="color:var(--primary);font-weight:700">${escapeHtml(driver.phone)}</a></div>` : ''}
        ${driver.vehicle ? `<div class="meta">🚗 المركبة: ${escapeHtml(driver.vehicle)} ${driver.vehicleNumber?('- '+escapeHtml(driver.vehicleNumber)):''}</div>` : ''}
        ${driver.wilaya ? `<div class="meta">📍 ${escapeHtml(driver.wilaya)}</div>` : ''}
        ${driverContactHtml(driver,r)}
      </div>
    ` : (r.driverId ? '<div class="meta" style="margin-top:8px">⏳ جاري تحميل معلومات الموصّل...</div>' : '');
    return `<div class="tracking-item">
      <b>${escapeHtml(r.listingTitle)}</b>
      <span class="tracking-status status-pending" style="margin-right:8px">${DELIVERY_STATUS_LABEL[r.status]||r.status}</span>
      ${driverInfo}
      ${DELETABLE_DELIVERY.includes(r.status)?`<div class="admin-item-actions"><button class="small-btn danger" data-del-delivery="${r.id}">🗑️ حذف الطلب</button></div>`:''}
    </div>`;
  }).join('');
  bindDeliveryButtons(el);
}

function renderConversations(){
  const el=$('#conversationList');if(!el)return;
  if(!currentUser){el.innerHTML='<div class="empty small-empty">سجّل الدخول باش تشوف محادثاتك.</div>';return;}
  el.innerHTML=conversations.length?conversations.map(c=>`<div class="conversation-item" data-id="${escapeHtml(c.id)}"><b>${escapeHtml(c.listingTitle||'محادثة')}</b><span>💬</span></div>`).join(''):'<div class="empty small-empty">لا محادثات بعد.</div>';
  $$('#conversationList [data-id]').forEach(x=>x.onclick=()=>{
    const c=conversations.find(z=>z.id===x.dataset.id);
    const other=c?.participants?.find(p=>p!==currentUser.uid);
    if(other)openConversationWith(other,{id:c.listingId,title:c.listingTitle});
  });
}

function renderBlocked(){
  const el=$('#blockedList');if(!el)return;
  if(!currentUser){el.innerHTML='<div class="empty small-empty">سجّل الدخول.</div>';return;}
  el.innerHTML=blocked.length?blocked.map(b=>`<div class="blocked-item"><b>${escapeHtml(b.targetName||'مستخدم')}</b><button class="small-btn" data-unblock="${escapeHtml(b.blockedUid)}">إلغاء الحظر</button></div>`).join(''):'<div class="empty small-empty">ما كاش حسابات محظورة.</div>';
  $$('#blockedList [data-unblock]').forEach(b=>b.onclick=()=>unblockUser(b.dataset.unblock));
}

function renderMyListings(){
  const el=$('#myListingsGrid');if(!el)return;
  if(!currentUser)return;
  const mine=myListings;
  el.innerHTML=mine.length?mine.map(card).join(''):'<div class="empty">ما نشرتش إعلانات بعد.</div>';
  $('#myListingsCard').hidden=!mine.length;
  $$('#myListingsGrid .heart').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleFavorite(b.dataset.fav);});
  $$('#myListingsGrid .listing').forEach(c=>{
    c.onclick=()=>openListing(c.dataset.id);
    const del=document.createElement('button');del.type='button';del.className='small-btn danger my-del-btn';del.textContent='🗑️ حذف';
    del.onclick=e=>{e.stopPropagation();deleteMyListing(c.dataset.id);};
    c.appendChild(del);
  });
}

function renderMyDeliveries(){
  const el=$('#myDeliveriesList');if(!el||!currentUser)return;
  const mine=deliveryRequests.filter(r=>r.buyerUid===currentUser.uid);
  $('#myDeliveriesCard').hidden=!mine.length;
  el.innerHTML=mine.length?mine.map(r=>{
    const driver = driverFromRequest(r);
    const driverInfo = driver ? `
      <div style="margin-top:10px;padding:10px;background:var(--primary-light);border-radius:8px">
        <div class="meta">🚚 الموصّل: <b>${escapeHtml(driver.name||'موصّل')}</b></div>
        ${driver.phone ? `<div class="meta">📞 <a href="tel:${escapeHtml(driver.phone)}" style="color:var(--primary);font-weight:700">${escapeHtml(driver.phone)}</a></div>` : ''}
        ${driver.vehicle ? `<div class="meta">🚗 ${escapeHtml(driver.vehicle)}</div>` : ''}
        ${driverContactHtml(driver,r)}
      </div>
    ` : '';
    return `<div class="tracking-item">
      <b>${escapeHtml(r.listingTitle)}</b>
      <span class="tracking-status status-pending" style="margin-right:8px">${DELIVERY_STATUS_LABEL[r.status]||r.status}</span>
      ${driverInfo}
      ${DELETABLE_DELIVERY.includes(r.status)?`<div class="admin-item-actions"><button class="small-btn danger" data-del-delivery="${r.id}">🗑️ حذف الطلب</button></div>`:''}
    </div>`;
  }).join(''):'<div class="empty">لا طلبات.</div>';
  bindDeliveryButtons(el);
}

function renderMyDriverDeliveries(){
  const el=$('#myDriverDeliveriesList');if(!el)return;
  if(!myDriver||myDriver.status!=='approved'){$('#myDriverDeliveriesCard').hidden=true;return;}
  const mine=deliveryRequests.filter(r=>r.driverUid===currentUser?.uid);
  $('#myDriverDeliveriesCard').hidden=!mine.length&&!driverPool.length;
  el.innerHTML=mine.map(r=>`<div class="tracking-item"><b>${escapeHtml(r.listingTitle)}</b><span class="tracking-status status-pending">${DELIVERY_STATUS_LABEL[r.status]||r.status}</span>
    <div class="admin-item-actions">
    ${r.status==='assigned'?`<button class="small-btn" data-driver-progress="${r.id}" data-next="picked_up">📦 استلمت الطرد</button>`:''}
    ${r.status==='picked_up'?`<button class="small-btn" data-driver-progress="${r.id}" data-next="delivering">🚗 في الطريق</button>`:''}
    ${r.status==='delivering'?`<button class="small-btn success" data-driver-progress="${r.id}" data-next="completed">✅ تم التسليم</button>`:''}
    </div></div>`).join('');
  $$('[data-driver-progress]').forEach(b=>b.onclick=()=>updateDeliveryStatus(b.dataset.driverProgress,b.dataset.next));
  let pl=$('#driverPoolList');
  if(!pl){pl=document.createElement('div');pl.id='driverPoolList';pl.className='tracking-list driver-pool';el.parentNode.insertBefore(pl,el);}
  const pool=[...driverPool].sort((x,y)=>(y.wilaya===myDriver.wilaya)-(x.wilaya===myDriver.wilaya));
  pl.innerHTML=pool.length?`<h3 class="pool-title">📥 طلبات متاحة (${pool.length})</h3>`+pool.map(p=>`<div class="tracking-item pool-item"><b>${escapeHtml(p.listingTitle||'طلب توصيل')}</b><div class="meta">📍 ${escapeHtml(p.wilaya||'')}${p.city?' - '+escapeHtml(p.city):''}${p.wilaya===myDriver.wilaya?' <span class="near-badge">فـ ولايتك</span>':''}</div><button class="small-btn success" data-pool-accept="${escapeHtml(p.id)}">✅ قبول الطلب</button></div>`).join(''):'';
  $$('[data-pool-accept]').forEach(b=>b.onclick=()=>acceptPoolRequest(b.dataset.poolAccept));
}
async function acceptPoolRequest(id){
  if(!myDriver||myDriver.status!=='approved'||!myDriver.verified)return;
  try{
    const b=writeBatch(db);
    b.update(doc(db,'deliveryRequests',id),{driverId:myDriver.id,driverUid:currentUser.uid,status:'assigned',updatedAt:serverTimestamp()});
    b.update(doc(db,'deliveryPool',id),{status:'taken',takenBy:currentUser.uid});
    await b.commit();toast('تم قبول الطلب ✅ المشتري يقدر يراسلك الآن.');
  }catch(e){console.warn(e);toast('الطلب مأخوذ من موصّل آخر أو تغيّر.');}
}

async function updateDeliveryStatus(id,status){
  try{await updateDoc(doc(db,'deliveryRequests',id),{status,updatedAt:serverTimestamp()});toast('تم تحديث الحالة ✅');}catch(e){toast('تعذر التحديث');}
}

async function openConversationWith(otherUid,listing){
  if(!requireLogin())return;
  if(blocked.some(b=>b.blockedUid===otherUid)){toast('لقد حظرت هذا المستخدم مسبقاً.');return;}
  if(otherUid===currentUser.uid){toast('ما تقدرش تراسل روحك.');return;}
  const id=[currentUser.uid,otherUid].sort().join('_')+'_'+(listing?.id||'general');
  const ref=doc(db,'conversations',id);
  try{
    const snap=await getDoc(ref);
    if(!snap.exists())await setDoc(ref,{participants:[currentUser.uid,otherUid],listingId:listing?.id||null,listingTitle:listing?.title||'',lastMessage:'',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    activeConversation={id,otherUid,listing};
    $('#chatTitle').textContent='💬 '+(listing?.title||'محادثة');
    $('#chatModal').hidden=false;
    if(unsub.messages)unsub.messages();
    unsub.messages=onSnapshot(query(collection(db,'conversations',id,'messages'),orderBy('createdAt','desc'),limit(100)),s=>{
      $('#chatMessages').innerHTML=[...s.docs].reverse().map(d=>`<div class="chat-message ${d.data().senderUid===currentUser.uid?'mine':''}">${escapeHtml(d.data().text)}</div>`).join('');
      $('#chatMessages').scrollTop=$('#chatMessages').scrollHeight;
    },e=>{console.error(e);toast('تعذر تحميل الرسائل.');});
  }catch(e){toast(e.code==='permission-denied'?'ما تقدرش تراسل هذا المستخدم.':'تعذر فتح المحادثة، حاول مجدداً.');}
}

async function sendMessage(e){
  e.preventDefault();if(!activeConversation||!requireLogin())return;
  const text=$('#chatInput').value.trim();if(!text)return;
  if(!cdCheck('msg',2500,'⏳ رويدك شوية قبل الرسالة الجاية.'))return;
  const spam=analyzeSpam(text);
  if(spam.blocked){toast('⚠️ الرسالة تحتوي محتوى ممنوع.');return;}
  try{
    const batch=writeBatch(db);
    const messageRef=doc(collection(db,'conversations',activeConversation.id,'messages'));
    batch.set(messageRef,{senderUid:currentUser.uid,text,createdAt:serverTimestamp()});
    batch.set(doc(db,'msgThrottle',currentUser.uid),{lastAt:serverTimestamp()});
    batch.update(doc(db,'conversations',activeConversation.id),{lastMessage:text,updatedAt:serverTimestamp()});
    const notificationRef=doc(db,'notifications','message_'+messageRef.id);
    batch.set(notificationRef,{toUserId:activeConversation.otherUid,fromUserId:currentUser.uid,type:'message',title:'رسالة جديدة',body:text.slice(0,150),conversationId:activeConversation.id,messageId:messageRef.id,read:false,createdAt:serverTimestamp()});
    await batch.commit();
    $('#chatInput').value='';
  }catch(e){toast(e.code==='permission-denied'?'ما تقدرش تراسل هذا المستخدم.':'تعذر إرسال الرسالة');}
}

async function blockActiveUser(){
  if(!activeConversation||!requireLogin())return;
  const otherUid=activeConversation.otherUid;
  const otherName=activeConversation.listing?.seller||'مستخدم';
  try{
    await setDoc(doc(db,'blocks',currentUser.uid+'_'+otherUid),{blockerUid:currentUser.uid,blockedUid:otherUid,targetName:otherName,createdAt:serverTimestamp()});
    toast('تم حظر المستخدم 🚫');
    $('#chatModal').hidden=true;activeConversation=null;
  }catch(e){toast('تعذر حظر المستخدم');}
}
async function unblockUser(uid){
  try{await deleteDoc(doc(db,'blocks',currentUser.uid+'_'+uid));toast('تم إلغاء الحظر');}catch(e){toast('تعذر إلغاء الحظر');}
}

function openRating(sellerUid,listingId){
  if(!requireLogin())return;
  ratingTarget={sellerUid,listingId};
  $('#ratingTitle').textContent='⭐ تقييم البائع';
  $('#ratingTargetUid').value=sellerUid;
  $('#ratingTargetId').value=listingId;
  $('#ratingValue').value='';
  $$('#starRating button').forEach(b=>b.classList.remove('active'));
  $('#ratingModal').hidden=false;
}
function initRatingForm(){
  $$('#starRating button').forEach(b=>b.onclick=()=>{
    const val=Number(b.dataset.star);
    $('#ratingValue').value=val;
    $$('#starRating button').forEach(s=>s.classList.toggle('active',Number(s.dataset.star)<=val));
  });
  $('#ratingForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!requireLogin()||!ratingTarget)return;
    const val=Number($('#ratingValue').value);
    if(!val){toast('اختار عدد النجوم أولاً');return;}
    const comment=$('#ratingForm [name=comment]').value.trim();
    if(ratingTarget.kind==='driver'){await submitDriverRating(val,comment,e.target);return;}
    try{
      // FIX: معرّف ثابت (raterUid_listingId) بدل معرّف عشوائي، حتى لو حاول نفس المستخدم
      // يقيّم نفس الإعلان مرة ثانية، تولي العملية "update" ماشي "create"، وقواعد الأمان
      // تمنع أي update على reviews (allow update: if false) — يعني تقييم واحد فقط للمستخدم بكل إعلان.
      // الترتيب مهم: نضيفو التقييم أولاً، وبعدها نزيدو المجموع فالإعلان،
      // باش لو فشلت الخطوة الثانية لأي سبب يبقى عندنا أثر التقييم فـreviews.
      const reviewRef=doc(db,'listings',ratingTarget.listingId,'reviews',`${currentUser.uid}_${ratingTarget.listingId}`);
      const rb=writeBatch(db);
      rb.set(reviewRef,{raterUid:currentUser.uid,raterName:currentProfile?.displayName||currentUser.displayName||'مستخدم',rating:val,comment,createdAt:serverTimestamp()});
      rb.update(doc(db,'listings',ratingTarget.listingId),{ratingSum:increment(val),ratingCount:increment(1),updatedAt:serverTimestamp()});
      await rb.commit();
      toast('شكراً على تقييمك ⭐');
      $('#ratingModal').hidden=true;e.target.reset();
    }catch(err){
      toast(err.code==='permission-denied'?'لقد قيّمت هذا الإعلان من قبل ⭐':'تعذر إرسال التقييم');
    }
  });
}

async function ensureUserProfile(user){
  const ref=doc(db,'users',user.uid),snap=await getDoc(ref);
  if(!snap.exists()){
    const p={uid:user.uid,displayName:user.displayName||'مستخدم',email:user.email||'',photoURL:user.photoURL||'',role:'user',verified:false,banned:false,createdAt:serverTimestamp()};
    await setDoc(ref,p);return p;
  }
  return {...snap.data(),uid:user.uid};
}

let deepLink=(()=>{const p=new URLSearchParams(location.search);return p.get('view')&&p.get('id')?{view:p.get('view'),id:p.get('id')}:null;})();
let deepLinkBusy=false;
async function handleDeepLink(){
  if(!deepLink)return;
  const{view,id}=deepLink;
  if(view==='listing'){
    if(deepLinkBusy)return;
    deepLinkBusy=true;deepLink=null;
    try{
      if(!listingMap.has(id)){const s=await getDoc(doc(db,'listings',id));if(s.exists())cacheListings([s]);}
      if(listingMap.has(id))openListing(id);
    }catch(e){console.error(e);}
    finally{deepLinkBusy=false;}
  }else if(view==='driver'&&drivers.some(d=>d.id===id)){
    deepLink=null;go('delivery');openDriverModal(id);
  }
}
function renderAll(){
  renderHome();
  renderFavorites();
  renderDrivers();
  renderNotifications();
  $('#favBadge').textContent=favorites.length;
  $('#favBadge').hidden=!favorites.length;
  if($('#searchView').classList.contains('active'))renderSearch();
  handleDeepLink();
}

// ----- بيانات عامة: بلا deliveryRequests (ماشي public data — كل مستخدم يشوف غير طلباتو) -----
// الإعلانات والسائقون والترويجات: قراءات محدودة (getDocs) بدل الاشتراك فكل الـcollection
function subscribeData(){
  loadHome();
  loadDrivers();
}

// ----- FIX: طلبات التوصيل خاصة بكل مستخدم — لازم query مفلترة، ماشي كل الـcollection -----
// نديرو listener للمشتري (buyerUid) و listener تاني للموصّل (driverId إذا كان عندو myDriver مفعّل)، ونجمعوهم فمصفوفة وحدة.
let myBuyerDeliveries=[], myDriverDeliveriesRaw=[];
function mergeDeliveryRequests(){
  const map=new Map();
  [...myBuyerDeliveries,...myDriverDeliveriesRaw].forEach(r=>map.set(r.id,r));
  deliveryRequests=[...map.values()];
  renderTracking();renderMyDeliveries();renderMyDriverDeliveries();
}

function subscribeMine(){
  if(!currentUser)return;
  loadMyListings(true);
  if(unsub.myDriver)unsub.myDriver();
  unsub.myDriver=onSnapshot(query(collection(db,'drivers'),where('ownerUid','==',currentUser.uid)),s=>{
    const prevId=myDriver?.id;
    myDriver=s.docs[0]?{id:s.docs[0].id,...s.docs[0].data()}:null;
    renderMyDriver();
    if(myDriver?.id!==prevId)subscribeDriverDeliveries();
  },e=>console.error(e));

  if(unsub.notifications)unsub.notifications();
  unsub.notifications=onSnapshot(query(collection(db,'notifications'),where('toUserId','==',currentUser.uid),orderBy('createdAt','desc'),limit(30)),s=>{notifications=s.docs.map(d=>({id:d.id,...d.data()}));renderNotifications();},e=>{console.warn('Notifications:',e);});

  if(unsub.conversations)unsub.conversations();
  unsub.conversations=onSnapshot(query(collection(db,'conversations'),where('participants','array-contains',currentUser.uid)),s=>{
    conversations=s.docs.map(d=>({id:d.id,...d.data()}));
    renderConversations();
  },e=>console.error(e));

  if(unsub.blocks)unsub.blocks();
  unsub.blocks=onSnapshot(query(collection(db,'blocks'),where('blockerUid','==',currentUser.uid)),s=>{
    blocked=s.docs.map(d=>({id:d.id,...d.data()}));
    renderBlocked();renderAll();
  },e=>console.error(e));

  if(unsub.buyerDeliveries)unsub.buyerDeliveries();
  unsub.buyerDeliveries=onSnapshot(query(collection(db,'deliveryRequests'),where('buyerUid','==',currentUser.uid)),s=>{
    myBuyerDeliveries=s.docs.map(d=>({id:d.id,...d.data()}));
    mergeDeliveryRequests();
  },e=>console.error(e));

  subscribeDriverDeliveries();
}

function subscribeDriverDeliveries(){
  if(unsub.driverPool){unsub.driverPool();unsub.driverPool=null;}driverPool=[];
  if(myDriver?.status==='approved'&&myDriver.verified){
    unsub.driverPool=onSnapshot(query(collection(db,'deliveryPool'),where('status','==','open'),limit(30)),s=>{driverPool=s.docs.map(d=>({id:d.id,...d.data()}));renderMyDriverDeliveries();},e=>console.warn('Pool:',e));
  }
  if(unsub.driverDeliveries)unsub.driverDeliveries();
  if(!myDriver?.id){myDriverDeliveriesRaw=[];mergeDeliveryRequests();return;}
  unsub.driverDeliveries=onSnapshot(query(collection(db,'deliveryRequests'),where('driverUid','==',currentUser.uid)),s=>{
    myDriverDeliveriesRaw=s.docs.map(d=>({id:d.id,...d.data()}));
    mergeDeliveryRequests();
  },e=>console.error(e));
}

async function renderProfile(uid){
  const el=$('#profileListings');if(!el)return;
  el.innerHTML='<div class="empty">جاري التحميل...</div>';
  try{
    const snap=await getDocs(query(collection(db,'listings'),where('status','==','published'),where('ownerUid','==',uid),limit(60)));
    cacheListings(snap.docs);
    const items=snap.docs.map(d=>listingMap.get(d.id)).sort((p,q)=>(q.createdAt?.seconds||0)-(p.createdAt?.seconds||0));
    const name=items[0]?.seller||'مستخدم';
    $('#profileName').textContent=name;$('#profileDisplayName').textContent=name;
    $('#profileMeta').textContent=items[0]?.createdAt?.seconds?`عضو منذ ${new Date(items[0].createdAt.seconds*1000).toLocaleDateString('ar-DZ')}`:'بائع في سوق الجزائر';
    const totalRatings=items.reduce((n,x)=>n+(Number(x.ratingCount)||0),0);
    const totalRatingSum=items.reduce((n,x)=>n+(Number(x.ratingSum)||0),0);
    const averageRating=totalRatings?(totalRatingSum/totalRatings).toFixed(1):'جديد';
    $('#profileStats').innerHTML=`<span>📢 ${items.length} إعلان منشور</span><span>⭐ ${averageRating} (${totalRatings} تقييم)</span>`;
    renderListings(items.filter(isVisibleListing),'#profileListings');
  }catch(e){handleQueryError(e);}
}

$$('[data-view]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.view)));
$('#globalSearch').addEventListener('input',()=>{go('search');applyFilters();$('#clearSearch').hidden=!$('#globalSearch').value;clearTimeout(suggestionTimer);suggestionTimer=setTimeout(renderSearchSuggestions,140);});
$('#clearSearch')?.addEventListener('click',()=>{$('#globalSearch').value='';$('#clearSearch').hidden=true;$('#searchSuggestions').hidden=true;applyFilters();});
$('#saveSearchBtn')?.addEventListener('click',saveCurrentSearch);
renderSavedSearches();
$('#heroSearchBtn').onclick=()=>{const q=$('#heroSearch').value.trim();$('#globalSearch').value=q;go('search');applyFilters();};
$('#postForm').addEventListener('submit',submitListing);
$('#driverForm').addEventListener('submit',submitDriver);
$('#chatForm').addEventListener('submit',sendMessage);
$('#reportForm').addEventListener('submit',submitReport);
$('#promoForm').addEventListener('submit',submitPromotion);
$('#firebaseLogin').onclick=loginGoogle;
$('#firebaseLogout').onclick=()=>signOut(auth);
$('#blockUserBtn')?.addEventListener('click',blockActiveUser);
$('#openTermsBtn')?.addEventListener('click',()=>{$('#termsModal').hidden=false;});
$$('[data-close-modal]').forEach(x=>x.addEventListener('click',closeModal));
$$('[data-close-chat]').forEach(x=>x.addEventListener('click',()=>{$('#chatModal').hidden=true;activeConversation=null;}));
$$('[data-close-report]').forEach(x=>x.addEventListener('click',closeReport));
$$('[data-close-rating]').forEach(x=>x.addEventListener('click',()=>{$('#ratingModal').hidden=true;}));
$$('[data-close-deliveryreq]').forEach(x=>x.addEventListener('click',closeDeliveryRequest));
$$('[data-close-terms]').forEach(x=>x.addEventListener('click',()=>{$('#termsModal').hidden=true;}));
document.addEventListener('keydown',ev=>{
  if(ev.key!=='Escape')return;
  const open=[...$$('.modal')].filter(m=>!m.hidden).pop();
  open?.querySelector('.modal-backdrop')?.click();
});
$('#resetFilters')?.addEventListener('click',()=>{
  $('#filterCategory').value='';$('#filterWilaya').value='';$('#filterCity').value='';
  $('#filterCondition').value='';$('#minPrice').value='';$('#maxPrice').value='';
  $('#filterDelivery').checked=false;if($('#filterVerified'))$('#filterVerified').checked=false;
  applyFilters();
});
['filterCategory','filterWilaya','filterCity','filterCondition','minPrice','maxPrice','filterDelivery','filterVerified'].forEach(id=>{
  const el=$('#'+id);if(el)el.addEventListener(id==='filterCity'?'input':'change',applyFilters);
});

$('#sortResults')?.addEventListener('change',renderSearch);
$('#loadMoreBtn')?.addEventListener('click',()=>loadSearchPage(false));
$$('[data-query]').forEach(b=>b.addEventListener('click',()=>{$('#globalSearch').value=b.dataset.query;$('#clearSearch').hidden=false;go('search');applyFilters();}));
categoryCards('#categoryGrid');
categoryCards('#allCategoryGrid');
selectOptions();
initDarkMode();
initImageUpload();
initDeliveryRequestForm();
initRatingForm();
setFirebaseState('Firebase: جاري التحقق...');
subscribeData();

onAuthStateChanged(auth,async user=>{
  currentUser=user;
  if(user){
    try{
      currentProfile=await ensureUserProfile(user);
      isAdmin=currentProfile?.role==='admin';
      favorites=currentProfile?.favoriteIds||[];
      setFirebaseState('متصل ✅',true);
      if(currentProfile?.banned)toast('🚫 حسابك موقوف من طرف الإدارة.');
      subscribeMine();
    }catch(e){console.error(e);isAdmin=false;}
  }else{
    currentProfile=null;isAdmin=false;favorites=[];blocked=[];conversations=[];notifications=[];myListings=[];myListingsLoaded=false;
    myDriver=null;myBuyerDeliveries=[];myDriverDeliveriesRaw=[];deliveryRequests=[];
    ['myDriver','conversations','blocks','buyerDeliveries','driverDeliveries','notifications'].forEach(k=>{
      if(typeof unsub[k]==='function')unsub[k]();
      delete unsub[k];
    });
    setFirebaseState('غير مسجل');
  }
  updateAccountUI();
  renderAll();
  renderTracking();renderMyDeliveries();renderMyDriverDeliveries();
});

function updateAccountUI(){
  const name=$('#accountName'),status=$('#accountStatus');
  if(!currentUser){$('#firebaseLogin').hidden=false;$('#firebaseLogout').hidden=true;name.textContent='زائر';status.textContent='سجّل الدخول';return;}
  $('#firebaseLogin').hidden=true;$('#firebaseLogout').hidden=false;
  name.textContent=currentProfile?.displayName||currentUser.displayName;
  status.textContent=isAdmin?'🛡️ أدمن':currentProfile?.banned?'🚫 موقوف':(currentProfile?.verified?'✓ موثّق':'عضو');
}

window.addEventListener('load',()=>{
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(e=>console.warn('SW:',e));
  }
});

// اختصارات: ?view=post|search|delivery|favorites|promotions|account (من أيقونة التطبيق أو روابط مباشرة)
(()=>{const v=new URLSearchParams(location.search).get('view');
  if(['post','search','delivery','favorites','promotions','account'].includes(v)&&!deepLink){try{go(v);}catch(e){console.warn(e);}}})();
