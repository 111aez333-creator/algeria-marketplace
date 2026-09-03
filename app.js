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

function isDuplicatePost(title,ownerUid){
  const norm=String(title||'').trim().toLowerCase();
  if(!norm)return false;
  const recentWindow=10*60*1000; // 10 minutes
  const nowApprox=Date.now();
  return listings.some(l=>{
    if(l.ownerUid!==ownerUid)return false;
    if(String(l.title||'').trim().toLowerCase()!==norm)return false;
    const created=l.createdAt?.seconds?l.createdAt.seconds*1000:nowApprox;
    return (nowApprox-created)<recentWindow;
  });
}

let listings=[], drivers=[], favorites=[], conversations=[], blocked=[];
let promotions=[], deliveryRequests=[];
let currentUser=null, currentProfile=null;
let isAdmin=false, myDriver=null, activeConversation=null;
let unsub={};
let currentImages=[];
let pendingIdCardUrl='', pendingSelfieUrl='', pendingLocation=null;
let ratingTarget=null;

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function toast(t){const x=$('#toast');if(!x)return;x.textContent=t;x.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>x.classList.remove('show'),3000);}
function formatPrice(v){return Number(v||0).toLocaleString('fr-DZ')+' دج';}
function setFirebaseState(t,g=false){const x=$('#firebaseState');if(x){x.textContent=t;x.className='notice '+(g?'notice-success':'');}}
function requireLogin(){if(!currentUser){toast('لازم تسجل الدخول أولاً 🔐');go('account');return false;}return true;}
function showLoading(on){const x=$('#loadingOverlay');if(x)x.hidden=!on;}

function go(view,params={}){
  $$('.view').forEach(v=>v.classList.remove('active'));
  const target=$(`#${view}View`);
  if(target)target.classList.add('active');
  else $('#homeView').classList.add('active');
  window.scrollTo({top:0,behavior:'smooth'});
  if(view==='search')applyFilters();
  if(view==='favorites')renderFavorites();
  if(view==='account'){renderConversations();renderBlocked();renderMyListings();renderMyDeliveries();renderMyDriverDeliveries();}
  if(view==='delivery')renderDrivers();
  if(view==='promotions')renderPromotions();
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

// ----- Post-listing image upload wiring (fixes: product image not showing) -----
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
  const urls=raw.split(',').map(s=>s.trim()).filter(s=>/^https?:\/\//i.test(s));
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
  ${img?`<img src="${escapeHtml(cloudinaryUrl(img,600,450))}" alt="${escapeHtml(x.title)}" loading="lazy">`:`<span>${escapeHtml(x.emoji||'🛍️')}</span>`}
  <button class="heart ${active?'active':''}" data-fav="${escapeHtml(x.id)}">${active?'♥':'♡'}</button></div>
  <div class="listing-body"><div class="meta">${escapeHtml(x.condition||'متاح')} • ${escapeHtml(x.category)}</div>
  <div class="listing-title">${escapeHtml(x.title)}</div><div class="price">${formatPrice(x.price)}</div>
  <div class="meta">📍 ${escapeHtml(x.wilaya||'الجزائر')} • 👤 ${escapeHtml(x.seller||'بائع')}${x.sellerVerified?' <span class="verified">✓</span>':''}</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
  ${x.delivery?'<span class="delivery-chip">🚗 توصيل</span>':''}
  ${rating?`<span class="rating-display">⭐ ${rating}</span>`:''}
  ${x.status==='pending'?'<span class="spam-flag">⏳ قيد المراجعة</span>':''}
  </div></div></article>`;
}

function visiblePublicListings(){
  const blockedSet=new Set(blocked.map(b=>b.blockedUid));
  return listings.filter(x=>x.status!=='rejected'&&!blockedSet.has(x.ownerUid)&&(x.status==='published'||x.ownerUid===currentUser?.uid||isAdmin));
}

function renderListings(items,target){
  const el=$(target);if(!el)return;
  el.innerHTML=items.length?items.map(card).join(''):'<div class="empty">ما لقيناش إعلانات مطابقة.</div>';
  $$(target+' .heart').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleFavorite(b.dataset.fav);});
  $$(target+' .listing').forEach(c=>c.onclick=()=>openListing(c.dataset.id));
}

// ----- Favorites (fixes: like/save button not toggling off) -----
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

function renderFavorites(){renderListings(visiblePublicListings().filter(x=>favorites.includes(x.id)),'#favoritesGrid');}

function applyFilters(){
  const q=$('#globalSearch').value.trim().toLowerCase(),cat=$('#filterCategory').value,w=$('#filterWilaya').value;
  const min=Number($('#minPrice').value||0),max=Number($('#maxPrice').value||Infinity);
  const delivery=$('#filterDelivery').checked;
  const verifiedOnly=$('#filterVerified')?.checked;
  const condition=$('#filterCondition')?.value;
  let arr=visiblePublicListings().filter(x=>{
    const text=`${x.title} ${x.category} ${x.wilaya}`.toLowerCase();
    return(!q||text.includes(q))&&(!cat||x.category===cat)&&(!w||x.wilaya===w)&&Number(x.price)>=min&&Number(x.price)<=max
      &&(!delivery||x.delivery)&&(!verifiedOnly||x.sellerVerified)&&(!condition||x.condition===condition);
  });
  const sort=$('#sortResults')?.value||'new';
  if(sort==='low')arr=[...arr].sort((a,b)=>Number(a.price)-Number(b.price));
  else if(sort==='high')arr=[...arr].sort((a,b)=>Number(b.price)-Number(a.price));
  else if(sort==='views')arr=[...arr].sort((a,b)=>(b.views||0)-(a.views||0));
  $('#searchTitle').textContent=q?`نتائج: ${q}`:cat||'كل الإعلانات';
  $('#resultCount').textContent=`${arr.length} إعلان`;
  renderListings(arr,'#resultsGrid');
}

async function openListing(id){
  const x=listings.find(i=>String(i.id)===String(id));if(!x)return;
  const seenKey='viewed_'+id;
  if(currentUser&&!sessionStorage.getItem(seenKey)){
    sessionStorage.setItem(seenKey,'1');
    try{await updateDoc(doc(db,'listings',id),{views:increment(1)});}catch{}
  }
  const owner=x.ownerUid,current=owner===currentUser?.uid;
  const allImages=x.images?.length?x.images:(x.image?[x.image]:[]);
  const rating=x.ratingCount?(x.ratingSum/x.ratingCount).toFixed(1):null;
  const gallery=allImages.length?
    `<div class="gallery-main"><img src="${escapeHtml(cloudinaryUrl(allImages[0],1000,800))}" alt=""></div>
     ${allImages.length>1?`<div class="image-preview-grid">${allImages.map(u=>`<div class="image-preview"><img src="${escapeHtml(cloudinaryUrl(u,200,200))}" alt=""></div>`).join('')}</div>`:''}`
    : `<div class="gallery-main">🛍️</div>`;
  $('#modalContent').innerHTML=`${gallery}
    <div class="meta">${escapeHtml(x.category)} • ${escapeHtml(x.condition)} • 👁️ ${x.views||0} مشاهدة ${rating?`• ⭐ ${rating} (${x.ratingCount})`:''}</div>
    <h2>${escapeHtml(x.title)}</h2><div class="detail-price">${formatPrice(x.price)}</div>
    <div class="meta">📍 ${escapeHtml(x.wilaya)}${x.city?(' - '+escapeHtml(x.city)):''} • 👤 ${escapeHtml(x.seller||'بائع')}${x.sellerVerified?' <span class="verified">✓</span>':''}</div>
    <p style="margin-top:10px;line-height:1.7">${escapeHtml(x.description||'')}</p>
    ${x.showPhone&&x.phone?`<div class="phone-box"><b>📞 ${escapeHtml(x.phone)}</b></div>`:''}
    ${x.status==='pending'?'<div class="notice notice-warning">⏳ هذا الإعلان قيد المراجعة من الإدارة، ما يظهرش للعموم حتى تتم الموافقة.</div>':''}
    <div class="detail-actions">
      ${!current?'<button class="primary" id="messageSellerBtn">💬 مراسلة البائع</button>':''}
      ${!current&&x.delivery?'<button class="secondary" id="requestDeliveryBtn">🚚 اطلب توصيل</button>':''}
      ${!current?'<button class="secondary" id="rateSellerBtn">⭐ قيّم البائع</button>':''}
      ${!current?'<button class="secondary" id="reportListingBtn">🚩 تبليغ</button>':''}
      <button class="secondary" id="modalFavoriteBtn">${favorites.includes(x.id)?'♥ محفوظ':'♡ حفظ'}</button>
    </div>`;
  if(!current){
    $('#messageSellerBtn').onclick=()=>openConversationWith(owner,x);
    $('#reportListingBtn').onclick=()=>openReport('listing',x.id);
    $('#rateSellerBtn').onclick=()=>openRating(owner,x.id);
    if(x.delivery)$('#requestDeliveryBtn').onclick=()=>openDeliveryRequest(x);
  }
  $('#modalFavoriteBtn').onclick=()=>toggleFavorite(x.id);
  $('#listingModal').hidden=false;
}

function closeModal(){$('#listingModal').hidden=true;}

async function submitListing(e){
  e.preventDefault();if(!requireLogin())return;
  if(currentProfile?.banned){toast('🚫 حسابك موقوف، لا يمكنك النشر.');return;}
  const f=new FormData(e.target),title=String(f.get('title')||'').trim(),price=Number(f.get('price'));
  const fullText=title+' '+String(f.get('description')||'');
  const spam=analyzeSpam(fullText);
  if(spam.blocked){toast('⚠️ المحتوى يحتوي على كلمات ممنوعة.');return;}
  if(isDuplicatePost(title,currentUser.uid)){toast('⚠️ عندك إعلان بنفس العنوان نشرته قريب. تفادى التكرار.');return;}
  const images=collectImageUrls();
  const flagged=spam.flagged||!images.length;
  const item={
    title,price,category:f.get('category'),wilaya:f.get('wilaya'),city:String(f.get('city')||'').trim(),
    condition:f.get('condition'),delivery:f.get('delivery')!=='يد بيد',
    images,image:images[0]||'',emoji:'🛍️',
    seller:currentProfile?.displayName||currentUser.displayName||'بائع',
    sellerVerified:currentProfile?.verified||false,ownerUid:currentUser.uid,
    description:String(f.get('description')||'').trim(),phone:String(f.get('phone')||'').trim(),
    showPhone:f.get('showPhone')!==null,
    status: flagged?'pending':'published',
    flagged, flagReason: spam.reason||(images.length?'':'بدون صور'),
    views:0,ratingCount:0,ratingSum:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  };
  try{
    showLoading(true);
    await addDoc(collection(db,'listings'),item);
    e.target.reset();currentImages=[];renderImagePreview();
    toast(flagged?'تم إرسال الإعلان، بانتظار مراجعة الإدارة ⏳':'تم نشر الإعلان بنجاح ✅');
    go('home');
  }catch(err){toast('فشل نشر الإعلان: '+err.code);}
  finally{showLoading(false);}
}

async function submitDriver(e){
  e.preventDefault();if(!requireLogin())return;
  const f=new FormData(e.target),birth=new Date(f.get('birth')),age=(Date.now()-birth.getTime())/(365.25*24*3600*1000);
  if(age<18){toast('لازم تكون 18 سنة أو أكثر');return;}
  const item={ownerUid:currentUser.uid,name:String(f.get('name')||'').trim(),birthDate:String(f.get('birth')),phone:String(f.get('phone')||'').trim(),wilaya:f.get('wilaya'),vehicle:f.get('vehicle'),vehicleNumber:String(f.get('vehicleNumber')||'').trim(),status:'pending',verified:false,activityStatus:'offline',lastSeenAt:serverTimestamp(),rating:null,rides:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  try{await addDoc(collection(db,'drivers'),item);e.target.reset();toast('تم إرسال طلب المراجعة 🛡️');}catch(err){toast('فشل إرسال الطلب');}
}

function renderDrivers(){
  const el=$('#driverGrid');if(!el)return;
  const approved=drivers.filter(d=>d.status==='approved'&&d.verified);
  el.innerHTML=approved.length?approved.map(d=>{const st=statusMeta(d);return`<article class="driver"><div class="driver-head"><h3>${escapeHtml(d.name||'موصّل')} ${d.verified?'<span class="verified">✓</span>':''}</h3><span class="status-dot ${st.s}">${st.label}</span></div><div class="meta">🚗 ${escapeHtml(d.vehicle||'مركبة')} • 📍 ${escapeHtml(d.wilaya||'')}</div><div class="activity-label">🕒 ${escapeHtml(st.lastSeen)}</div></article>`}).join(''):'<div class="empty">ما كاش موصلين موثّقين حالياً.</div>';
  const homeEl=$('#homeDrivers');if(homeEl){const activeDrivers=approved.filter(d=>d.activityStatus==='active').slice(0,4);homeEl.innerHTML=activeDrivers.length?activeDrivers.map(d=>{const st=statusMeta(d);return`<article class="driver"><div class="driver-head"><h3>${escapeHtml(d.name||'موصّل')}</h3><span class="status-dot ${st.s}">${st.label}</span></div></article>`}).join(''):'<div class="empty">ما كاش موصلين نشطين.</div>';}
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
  try{
    await addDoc(collection(db,'reports'),{reporterUid:currentUser.uid,reporterName:currentProfile?.displayName||currentUser.displayName||'مستخدم',targetType:$('#reportTargetType').value,targetId:$('#reportTargetId').value,reason:$('#reportReason').value,details:$('#reportDetails').value.trim(),status:'open',createdAt:serverTimestamp()});
    toast('تم إرسال البلاغ 🚩');closeReport();e.target.reset();
  }catch(e){toast('تعذر إرسال البلاغ');}
}

function openReport(type,id){if(!requireLogin())return;$('#reportTargetId').value=id;$('#reportTargetType').value=type;$('#reportModal').hidden=false;}
function closeReport(){$('#reportModal').hidden=true;}

async function submitPromotion(e){
  e.preventDefault();if(!requireLogin())return;
  const f=new FormData(e.target);
  const spam=analyzeSpam(String(f.get('name')||'')+' '+String(f.get('description')||''));
  if(spam.blocked){toast('⚠️ المحتوى يحتوي على كلمات ممنوعة.');return;}
  let imageUrl='';
  const file=$('#promoImageInput');
  try{
    showLoading(true);
    if(file?.files.length){imageUrl=await uploadImageToCloudinary(file.files[0],'souq-algeria/promotions');}
    const item={ownerUid:currentUser.uid,name:String(f.get('name')||'').trim(),type:f.get('type'),wilaya:f.get('wilaya'),url:String(f.get('url')||'').trim(),description:String(f.get('description')||'').trim(),image:imageUrl,status:'pending',createdAt:serverTimestamp()};
    await addDoc(collection(db,'promotions'),item);
    e.target.reset();toast('تم إرسال الترويج، بانتظار المراجعة 📣');
  }catch(err){toast('فشل إرسال الترويج');}
  finally{showLoading(false);}
}

function renderPromotions(){
  const el=$('#promoGrid');if(!el)return;
  const approved=promotions.filter(p=>p.status==='approved');
  el.innerHTML=approved.length?approved.map(p=>`<div class="promo-card">${p.image?`<img src="${escapeHtml(cloudinaryUrl(p.image,200,200))}" alt="">`:'📣'}<h3>${escapeHtml(p.name)}</h3><div class="meta">${escapeHtml(p.type)}</div>${p.url?`<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">زيارة الرابط ↗</a>`:''}</div>`).join(''):'<div class="empty">ما كاش ترويجات بعد.</div>';
}

// ----- Delivery request (buyer KYC: ID card + selfie) -----
function openDeliveryRequest(listing){
  if(!requireLogin())return;
  pendingIdCardUrl='';pendingSelfieUrl='';pendingLocation=null;
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
    const f=new FormData(e.target);
    const idFile=$('#idCardInput').files[0], selfieFile=$('#selfieInput').files[0];
    if(!idFile||!selfieFile){toast('لازم ترفع صورة البطاقة والسيلفي.');return;}
    const listingId=$('#deliveryReqListingId').value;
    const listing=listings.find(l=>l.id===listingId);
    if(!listing){toast('الإعلان غير موجود.');return;}
    try{
      showLoading(true);
      pendingIdCardUrl=await uploadImageToCloudinary(idFile,'souq-algeria/kyc');
      pendingSelfieUrl=await uploadImageToCloudinary(selfieFile,'souq-algeria/kyc');
      const item={
        listingId, listingTitle:listing.title, sellerUid:listing.ownerUid,
        buyerUid:currentUser.uid, buyerName:String(f.get('fullName')||'').trim(),
        phone:String(f.get('phone')||'').trim(), wilaya:f.get('wilaya'), city:String(f.get('city')||'').trim(),
        address:String(f.get('address')||'').trim(),
        idCardUrl:pendingIdCardUrl, selfieUrl:pendingSelfieUrl,
        location:pendingLocation, driverId:null,
        status:'pending_review', createdAt:serverTimestamp(), updatedAt:serverTimestamp()
      };
      await addDoc(collection(db,'deliveryRequests'),item);
      closeDeliveryRequest();closeModal();
      toast('تم إرسال طلب التوصيل، الإدارة بصدد مراجعة هويتك 🛡️');
    }catch(err){toast(err.message||'فشل إرسال طلب التوصيل');}
    finally{showLoading(false);}
  });
}

const DELIVERY_STATUS_LABEL={
  pending_review:'⏳ قيد مراجعة الهوية', approved:'✅ تمت الموافقة، بانتظار موصّل',
  assigned:'🚚 تم تعيين موصّل', picked_up:'📦 تم الاستلام', delivering:'🚗 في الطريق',
  completed:'✅ تم التسليم', rejected:'❌ مرفوض', cancelled:'✖️ ملغى'
};

function renderTracking(){
  const el=$('#trackingList');if(!el)return;
  const mine=deliveryRequests.filter(r=>r.buyerUid===currentUser?.uid);
  if(!mine.length){el.innerHTML='<div class="empty">ما كاش طلبات توصيل.</div>';return;}
  el.innerHTML=mine.map(r=>`<div class="tracking-item"><b>${escapeHtml(r.listingTitle)}</b><span class="tracking-status status-pending">${DELIVERY_STATUS_LABEL[r.status]||r.status}</span></div>`).join('');
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
  const mine=listings.filter(l=>l.ownerUid===currentUser.uid);
  el.innerHTML=mine.length?mine.map(card).join(''):'<div class="empty">ما نشرتش إعلانات بعد.</div>';
  $('#myListingsCard').hidden=!mine.length;
  $$('#myListingsGrid .heart').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleFavorite(b.dataset.fav);});
  $$('#myListingsGrid .listing').forEach(c=>c.onclick=()=>openListing(c.dataset.id));
}

function renderMyDeliveries(){
  const el=$('#myDeliveriesList');if(!el||!currentUser)return;
  const mine=deliveryRequests.filter(r=>r.buyerUid===currentUser.uid);
  $('#myDeliveriesCard').hidden=!mine.length;
  el.innerHTML=mine.length?mine.map(r=>`<div class="tracking-item"><b>${escapeHtml(r.listingTitle)}</b><span class="tracking-status status-pending">${DELIVERY_STATUS_LABEL[r.status]||r.status}</span></div>`).join(''):'<div class="empty">لا طلبات.</div>';
}

function renderMyDriverDeliveries(){
  const el=$('#myDriverDeliveriesList');if(!el)return;
  if(!myDriver||myDriver.status!=='approved'){$('#myDriverDeliveriesCard').hidden=true;return;}
  const mine=deliveryRequests.filter(r=>r.driverId===myDriver.id);
  $('#myDriverDeliveriesCard').hidden=!mine.length;
  el.innerHTML=mine.map(r=>`<div class="tracking-item"><b>${escapeHtml(r.listingTitle)}</b><span class="tracking-status status-pending">${DELIVERY_STATUS_LABEL[r.status]||r.status}</span>
    <div class="admin-item-actions">
    ${r.status==='assigned'?`<button class="small-btn" data-driver-progress="${r.id}" data-next="picked_up">📦 استلمت الطرد</button>`:''}
    ${r.status==='picked_up'?`<button class="small-btn" data-driver-progress="${r.id}" data-next="delivering">🚗 في الطريق</button>`:''}
    ${r.status==='delivering'?`<button class="small-btn success" data-driver-progress="${r.id}" data-next="completed">✅ تم التسليم</button>`:''}
    </div></div>`).join('');
  $$('[data-driver-progress]').forEach(b=>b.onclick=()=>updateDeliveryStatus(b.dataset.driverProgress,b.dataset.next));
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
    unsub.messages=onSnapshot(query(collection(db,'conversations',id,'messages'),orderBy('createdAt','asc')),s=>{
      $('#chatMessages').innerHTML=s.docs.map(d=>`<div class="chat-message ${d.data().senderUid===currentUser.uid?'mine':''}">${escapeHtml(d.data().text)}</div>`).join('');
      $('#chatMessages').scrollTop=$('#chatMessages').scrollHeight;
    },e=>{console.error(e);toast('تعذر تحميل الرسائل.');});
  }catch(e){toast('تعذر فتح المحادثة، حاول مجدداً.');}
}

async function sendMessage(e){
  e.preventDefault();if(!activeConversation||!requireLogin())return;
  const text=$('#chatInput').value.trim();if(!text)return;
  const spam=analyzeSpam(text);
  if(spam.blocked){toast('⚠️ الرسالة تحتوي محتوى ممنوع.');return;}
  try{
    await addDoc(collection(db,'conversations',activeConversation.id,'messages'),{senderUid:currentUser.uid,text,createdAt:serverTimestamp()});
    await updateDoc(doc(db,'conversations',activeConversation.id),{lastMessage:text,updatedAt:serverTimestamp()});
    $('#chatInput').value='';
  }catch(e){toast('تعذر إرسال الرسالة');}
}

// ----- Block user -----
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

// ----- Ratings (was previously dead UI, now wired) -----
function openRating(sellerUid,listingId){
  if(!requireLogin())return;
  ratingTarget={sellerUid,listingId};
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
    try{
      await updateDoc(doc(db,'listings',ratingTarget.listingId),{ratingSum:increment(val),ratingCount:increment(1)});
      await addDoc(collection(db,'listings',ratingTarget.listingId,'reviews'),{raterUid:currentUser.uid,raterName:currentProfile?.displayName||currentUser.displayName,rating:val,comment,createdAt:serverTimestamp()});
      toast('شكراً على تقييمك ⭐');
      $('#ratingModal').hidden=true;e.target.reset();
    }catch(err){toast('تعذر إرسال التقييم');}
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

function renderAll(){
  renderListings(visiblePublicListings().slice(0,8),'#homeListings');
  renderFavorites();
  renderDrivers();
  $('#favBadge').textContent=favorites.length;
  $('#favBadge').hidden=!favorites.length;
  if($('#searchView').classList.contains('active'))applyFilters();
}

function subscribeData(){
  if(unsub.listings)unsub.listings();
  unsub.listings=onSnapshot(collection(db,'listings'),s=>{listings=s.docs.map(d=>({id:d.id,...d.data()}));renderAll();},e=>console.error(e));
  if(unsub.drivers)unsub.drivers();
  unsub.drivers=onSnapshot(collection(db,'drivers'),s=>{drivers=s.docs.map(d=>({id:d.id,...d.data()}));renderDrivers();renderMyDriver();renderMyDriverDeliveries();},e=>console.error(e));
  if(unsub.promotions)unsub.promotions();
  unsub.promotions=onSnapshot(collection(db,'promotions'),s=>{promotions=s.docs.map(d=>({id:d.id,...d.data()}));renderPromotions();},e=>console.error(e));
  if(unsub.deliveryRequestsAll)unsub.deliveryRequestsAll();
  unsub.deliveryRequestsAll=onSnapshot(collection(db,'deliveryRequests'),s=>{deliveryRequests=s.docs.map(d=>({id:d.id,...d.data()}));renderTracking();renderMyDeliveries();renderMyDriverDeliveries();},e=>console.error(e));
}

function subscribeMine(){
  if(!currentUser)return;
  if(unsub.myDriver)unsub.myDriver();
  unsub.myDriver=onSnapshot(query(collection(db,'drivers'),where('ownerUid','==',currentUser.uid)),s=>{
    myDriver=s.docs[0]?{id:s.docs[0].id,...s.docs[0].data()}:null;
    renderMyDriver();renderMyDriverDeliveries();
  },e=>console.error(e));
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
}

async function renderProfile(uid){
  const el=$('#profileListings');if(!el)return;
  const owner=listings.find(l=>l.ownerUid===uid);
  $('#profileName').textContent=owner?.seller||'مستخدم';
  $('#profileDisplayName').textContent=owner?.seller||'مستخدم';
  renderListings(visiblePublicListings().filter(l=>l.ownerUid===uid),'#profileListings');
}

$$('[data-view]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.view)));
$('#globalSearch').addEventListener('input',()=>{go('search');applyFilters();});
$('#clearSearch')?.addEventListener('click',()=>{$('#globalSearch').value='';$('#clearSearch').hidden=true;applyFilters();});
$('#globalSearch').addEventListener('input',()=>{$('#clearSearch').hidden=!$('#globalSearch').value;});
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
$('#resetFilters')?.addEventListener('click',()=>{
  $('#filterCategory').value='';$('#filterWilaya').value='';$('#filterCity').value='';
  $('#filterCondition').value='';$('#minPrice').value='';$('#maxPrice').value='';
  $('#filterDelivery').checked=false;if($('#filterVerified'))$('#filterVerified').checked=false;
  applyFilters();
});
['filterCategory','filterWilaya','filterCity','filterCondition','minPrice','maxPrice','filterDelivery','filterVerified','sortResults'].forEach(id=>{
  const el=$('#'+id);if(el)el.addEventListener(id==='filterCity'?'input':'change',applyFilters);
});

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
    currentProfile=null;isAdmin=false;favorites=[];blocked=[];conversations=[];
    setFirebaseState('غير مسجل');
  }
  updateAccountUI();
  renderAll();
});

function updateAccountUI(){
  const name=$('#accountName'),status=$('#accountStatus');
  if(!currentUser){$('#firebaseLogin').hidden=false;$('#firebaseLogout').hidden=true;name.textContent='زائر';status.textContent='سجّل الدخول';return;}
  $('#firebaseLogin').hidden=true;$('#firebaseLogout').hidden=false;
  name.textContent=currentProfile?.displayName||currentUser.displayName;
  status.textContent=isAdmin?'🛡️ أدمن':currentProfile?.banned?'🚫 موقوف':(currentProfile?.verified?'✓ موثّق':'عضو');
}

window.addEventListener('load',()=>{
  const params=new URLSearchParams(window.location.search);
  if(params.get('view')==='listing')openListing(params.get('id'));
});
