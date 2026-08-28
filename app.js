import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  getFirestore, collection, addDoc, doc, getDoc, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit, where, onSnapshot, serverTimestamp, arrayUnion, arrayRemove,
  getDocs, writeBatch, increment, startAfter
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
  ['🚗','سيارات ومركبات'],['📱','هواتف وإلكترونيات'],['🏠','أثاث وديكور'],['👕','ملابس وأزياء'],
  ['🏢','العقار'],['🛠️','الخدمات'],['🌾','الفلاحة'],['🏭','معدات ومهنية'],
  ['🎮','ألعاب وترفيه'],['📚','كتب ودراسة'],['👶','الأطفال والأم'],['🐕','حيوانات'],
  ['🎁','أخرى']
];

const wilayas = ['أدرار','الشلف','الأغواط','أم البواقي','باتنة','بجاية','بسكرة','بشار','البليدة','البويرة','تمنراست','تبسة','تلمسان','تيارت','تيزي وزو','الجزائر','الجلفة','جيجل','سطيف','سعيدة','سكيكدة','سيدي بلعباس','عنابة','قالمة','قسنطينة','المدية','مستغانم','المسيلة','معسكر','ورقلة','وهران','البيض','إليزي','برج بوعريريج','بومرداس','الطارف','تندوف','تيسمسيلت','الوادي','خنشلة','سوق أهراس','تيبازة','ميلة','عين الدفلى','النعامة','عين تموشنت','غرداية','غليزان','تيميمون','برج باجي مختار','أولاد جلال','بني عباس','إن صالح','إن قزام','تقرت','جانت','المغير','المنيعة'];

const SPAM_WORDS = ['احتيال','نصب','مخدرات','سلاح','جنس','إباحي','fake','scam'];
const AI_CATEGORY_HINTS = {
  'سيارات': 'سيارات ومركبات', 'هاتف': 'هواتف وإلكترونيات', 'iphone': 'هواتف وإلكترونيات', 'سامسونج': 'هواتف وإلكترونيات',
  'أثاث': 'أثاث وديكور', 'كنبة': 'أثاث وديكور', 'سرير': 'أثاث وديكور', 'ملابس': 'ملابس وأزياء', 'قميص': 'ملابس وأزياء',
  'عقار': 'العقار', 'شقة': 'العقار', 'أرض': 'العقار', 'خدمة': 'الخدمات', 'فلاحة': 'الفلاحة', 'معدات': 'معدات ومهنية',
  'لعبة': 'ألعاب وترفيه', 'كتاب': 'كتب ودراسة', 'طفل': 'الأطفال والأم', 'حيوان': 'حيوانات', 'قط': 'حيوانات', 'كلب': 'حيوانات'
};

let listings=[], drivers=[], favorites=[], conversations=[], blocked=[];
let promotions=[], deliveryRequests=[], usersList=[];
let currentUser=null, currentProfile=null;
let isAdmin=false, myDriver=null, activeConversation=null;
let unsub={};
let currentImages=[];
let darkMode=localStorage.getItem('darkMode')==='true';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function toast(t){const x=$('#toast');if(!x)return;x.textContent=t;x.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>x.classList.remove('show'),3000);}
function formatPrice(v){return Number(v||0).toLocaleString('fr-DZ')+' دج';}
function formatDate(ts){if(!ts)return'';const d=ts.toDate?ts.toDate():new Date(ts);return d.toLocaleDateString('ar-DZ',{year:'numeric',month:'short',day:'numeric'});}
function setFirebaseState(t,g=false){const x=$('#firebaseState');if(x){x.textContent=t;x.className='notice '+(g?'notice-success':'');}}
function requireLogin(){if(!currentUser){toast('لازم تسجل الدخول أولاً 🔐');go('account');return false;}return true;}
function showLoading(show){$('#loadingOverlay').hidden=!show;}

function go(view,params={}){
  $$('.view').forEach(v=>v.classList.remove('active'));
  const target=$(`#${view}View`);
  if(target)target.classList.add('active');
  else $('#homeView').classList.add('active');
  window.scrollTo({top:0,behavior:'smooth'});
  if(view==='search')applyFilters();
  if(view==='favorites')renderFavorites();
  if(view==='admin')renderAdmin();
  if(view==='account'){renderConversations();renderBlocked();renderMyListings();renderMyDeliveries();}
  if(view==='delivery')renderDrivers();
  if(view==='promotions')renderPromotions();
  if(view==='profile'&&params.uid)renderProfile(params.uid);
  if(view==='tracking')renderTracking();
  $$('.mobile-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  const url=new URL(window.location.href);
  url.searchParams.set('view',view);
  if(params.id)url.searchParams.set('id',params.id);
  if(params.uid)url.searchParams.set('uid',params.uid);
  window.history.replaceState({},'',url);
}

function handleUrlParams(){
  const params=new URLSearchParams(window.location.search);
  const view=params.get('view');
  const id=params.get('id');
  const uid=params.get('uid');
  if(view==='listing'&&id){setTimeout(()=>openListing(id),800);}
  else if(view==='profile'&&uid){go('profile',{uid});}
  else if(view&&$(`#${view}View`)){go(view,{id,uid});}
}

function initDarkMode(){
  if(darkMode)document.documentElement.setAttribute('data-theme','dark');
  $('#darkModeToggle').onclick=()=>{
    darkMode=!darkMode;
    localStorage.setItem('darkMode',darkMode);
    document.documentElement.setAttribute('data-theme',darkMode?'dark':'');
    $('#darkModeToggle').textContent=darkMode?'☀️':'🌙';
  };
  $('#darkModeToggle').textContent=darkMode?'☀️':'🌙';
}

function selectOptions(){
  const opts=categories.map(([i,n])=>`<option value="${escapeHtml(n)}">${i} ${escapeHtml(n)}</option>`).join('');
  const all=wilayas.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
  const fc=$('#filterCategory'),pc=$('#postCategory'),dc=$('#driverWilaya'),prc=$('#promoWilaya');
  if(fc)fc.innerHTML='<option value="">كل الأقسام</option>'+opts;
  if(pc)pc.innerHTML='<option value="">اختار القسم</option>'+opts;
  if(dc)dc.innerHTML='<option value="">اختار الولاية</option>'+all;
  if(prc)prc.innerHTML='<option value="">اختار الولاية</option>'+all;
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

async function uploadImageToCloudinary(file){
  if(!file)return'';
  if(CLOUDINARY_CLOUD_NAME.startsWith('YOUR_')||CLOUDINARY_UPLOAD_PRESET.startsWith('YOUR_'))throw new Error('كمّل إعداد Cloudinary أولاً.');
  const allowed=['image/jpeg','image/png','image/webp'];if(!allowed.includes(file.type))throw new Error('استعمل JPG أو PNG أو WebP.');
  if(file.size>8*1024*1024)throw new Error('الصورة كبيرة بزاف. الحد الأقصى 8MB.');
  const form=new FormData();form.append('file',file);form.append('upload_preset',CLOUDINARY_UPLOAD_PRESET);form.append('folder','souq-algeria/listings');
  const res=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUDINARY_CLOUD_NAME)}/image/upload`,{method:'POST',body:form});
  const data=await res.json();if(!res.ok||!data.secure_url)throw new Error(data.error?.message||'فشل رفع الصورة.');
  return data.secure_url;
}

function statusMeta(d){
  const s=d.activityStatus==='active'?'active':d.activityStatus==='busy'?'busy':'offline';
  const label=s==='active'?'متصل الآن':s==='busy'?'مشغول':'غير متصل';
  const lastSeen=d.lastSeenAt?formatDate(d.lastSeenAt):'';
  return {s,label,lastSeen};
}

function card(x){
  const active=favorites.includes(x.id);
  const img=x.images?.[0]||x.image||'';
  const rating=x.ratingCount?(x.ratingSum/x.ratingCount).toFixed(1):null;
  return `<article class="listing" data-id="${escapeHtml(x.id)}"><div class="listing-img">
  ${img?`<img src="${escapeHtml(cloudinaryUrl(img,600,450))}" alt="${escapeHtml(x.title)}" loading="lazy" decoding="async">`:escapeHtml(x.emoji||'🛍️')}
  <button class="heart ${active?'active':''}" data-fav="${escapeHtml(x.id)}" title="المفضلة" aria-label="المفضلة">${active?'♥':'♡'}</button></div>
  <div class="listing-body"><div class="meta">${escapeHtml(x.condition||'متاح')} • ${escapeHtml(x.category)}</div>
  <div class="listing-title">${escapeHtml(x.title)}</div><div class="price">${formatPrice(x.price)}</div>
  <div class="meta">📍 ${escapeHtml(x.wilaya||'الجزائر')}${x.city?' — '+escapeHtml(x.city):''} • 👤 ${escapeHtml(x.seller||'بائع')}</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
  ${x.delivery?'<span class="delivery-chip">🚗 توصيل</span>':''}
  ${x.showPhone?'<span class="delivery-chip" style="background:#dbeafe;color:#1d4ed8">📞 هاتف</span>':''}
  ${rating?`<span class="rating-display">⭐ ${rating}</span>`:''}
  ${x.views?`<span class="views-chip">👁️ ${x.views}</span>`:''}
  </div></div></article>`;
}

function bindListingEvents(target){
  $$(target+' .heart').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleFavorite(b.dataset.fav);});
  $$(target+' .listing').forEach(c=>c.onclick=()=>openListing(c.dataset.id));
}

function renderListings(items,target){
  const el=$(target);if(!el)return;
  el.innerHTML=items.length?items.map(card).join(''):'<div class="empty">ما لقيناش إعلانات مطابقة.<br>جرّب كلمة أخرى أو مسح بعض الفلاتر.</div>';
  bindListingEvents(target);
}

async function toggleFavorite(id){
  if(!requireLogin())return;const has=favorites.includes(id);
  try{await updateDoc(doc(db,'users',currentUser.uid),{favoriteIds:has?arrayRemove(id):arrayUnion(id),updatedAt:serverTimestamp()});favorites=has?favorites.filter(x=>x!==id):[...favorites,id];renderAll();toast(has?'تحيدات من المفضلة':'تمت الإضافة للمفضلة ❤️');}catch(e){console.error(e);toast('تعذر تحديث المفضلة.');}
}

function renderFavorites(){renderListings(listings.filter(x=>favorites.includes(String(x.id))||favorites.includes(x.id)),'#favoritesGrid');}

function applyFilters(){
  const q=$('#globalSearch').value.trim().toLowerCase(),cat=$('#filterCategory').value,w=$('#filterWilaya').value;
  const city=$('#filterCity')?.value.trim().toLowerCase()||'',cond=$('#filterCondition').value;
  const min=Number($('#minPrice').value||0),max=Number($('#maxPrice').value||Infinity);
  const delivery=$('#filterDelivery').checked,verified=$('#filterVerified')?.checked;
  const sort=$('#sortResults').value;
  let arr=listings.filter(x=>{
    const text=`${x.title} ${x.category} ${x.wilaya} ${x.city||''} ${x.description||''}`.toLowerCase();
    return(!q||text.includes(q))&&(!cat||x.category===cat)&&(!w||x.wilaya===w)&&(!city||(x.city||'').toLowerCase().includes(city))&&(!cond||x.condition===cond)&&Number(x.price)>=min&&Number(x.price)<=max&&(!delivery||x.delivery)&&(!verified||x.sellerVerified);
  });
  if(sort==='low')arr.sort((a,b)=>Number(a.price)-Number(b.price));
  if(sort==='high')arr.sort((a,b)=>Number(b.price)-Number(a.price));
  if(sort==='views')arr.sort((a,b)=>(b.views||0)-(a.views||0));
  $('#searchTitle').textContent=q?`نتائج: ${q}`:cat||'كل الإعلانات';
  $('#resultCount').textContent=`${arr.length} إعلان`;
  renderListings(arr,'#resultsGrid');
}

async function openListing(id){
  const x=listings.find(i=>String(i.id)===String(id));if(!x)return;
  const seenKey='viewed_'+id;
  if(currentUser&&!sessionStorage.getItem(seenKey)){
    sessionStorage.setItem(seenKey,'1');
    try{await updateDoc(doc(db,'listings',id),{views:increment(1)});x.views=(x.views||0)+1;}catch{}
  }
  const owner=x.ownerUid,current=owner===currentUser?.uid;
  const img=x.images?.[0]||x.image||'';
  const allImages=x.images?.length?x.images:(x.image?[x.image]:[]);
  const rating=x.ratingCount?(x.ratingSum/x.ratingCount).toFixed(1):null;
  const shareUrl=`${window.location.origin}${window.location.pathname}?view=listing&id=${x.id}`;

  let galleryHtml='';
  if(allImages.length>1){
    galleryHtml=`<div class="gallery-main" id="galleryMain">${img?`<img src="${escapeHtml(cloudinaryUrl(img,1000,800))}" alt="${escapeHtml(x.title)}">`:escapeHtml(x.emoji||'🛍️')}</div>
    <div class="gallery-thumbs">${allImages.map((u,i)=>`<img src="${escapeHtml(cloudinaryUrl(u,200,200))}" class="${i===0?'active':''}" data-index="${i}" data-full="${escapeHtml(u)}">`).join('')}</div>`;
  }else{
    galleryHtml=`<div class="gallery-main">${img?`<img src="${escapeHtml(cloudinaryUrl(img,1000,800))}" alt="${escapeHtml(x.title)}">`:escapeHtml(x.emoji||'🛍️')}</div>`;
  }

  $('#modalContent').innerHTML=`${galleryHtml}
    <div class="meta" style="margin-top:10px">${escapeHtml(x.category)} • ${escapeHtml(x.condition)} • 👁️ ${x.views||0} مشاهدة</div>
    <h2>${escapeHtml(x.title)}</h2>
    <div class="detail-price">${formatPrice(x.price)}</div>
    <div class="meta">📍 ${escapeHtml(x.wilaya)}${x.city?' — '+escapeHtml(x.city):''} • 👤 ${escapeHtml(x.seller||'بائع')}</div>
    ${rating?`<div class="rating-display" style="margin-top:6px">⭐ ${rating} <span class="muted">(${x.ratingCount} تقييم)</span></div>`:''}
    <p style="margin-top:10px;line-height:1.7">${escapeHtml(x.description||'لا يوجد وصف إضافي.')}</p>
    ${x.delivery?'<div class="delivery-chip" style="margin-top:10px">🚗 التوصيل متاح</div>':''}
    ${x.showPhone&&x.phone?`<div class="phone-box"><b>📞 ${escapeHtml(x.phone)}</b><button onclick="navigator.clipboard?.writeText('${escapeHtml(x.phone)}');toast('تم نسخ الرقم 📋')">نسخ</button></div>`:''}
    <div class="detail-actions">
      ${!current?'<button class="primary" id="messageSellerBtn">💬 مراسلة البائع</button>':''}
      ${!current?'<button class="secondary" id="reportListingBtn">🚩 تبليغ</button>':''}
      ${!current?'<button class="secondary" id="blockSellerBtn">🚫 حظر</button>':''}
      ${!current&&x.delivery?'<button class="primary" id="requestDeliveryBtn">🚚 طلب توصيل</button>':''}
      ${!current?'<button class="secondary" id="rateSellerBtn">⭐ تقييم</button>':''}
      <button class="secondary" id="modalFavoriteBtn">${favorites.includes(x.id)||favorites.includes(String(x.id))?'♥ محفوظ':'♡ حفظ'}</button>
      ${current||isAdmin?'<button id="deleteListingBtn" class="small-btn danger">🗑️ حذف</button>':''}
    </div>
    <div class="share-bar">
      <button onclick="shareTo('whatsapp','${escapeHtml(shareUrl)}','${escapeHtml(x.title)}')">واتساب</button>
      <button onclick="shareTo('facebook','${escapeHtml(shareUrl)}','${escapeHtml(x.title)}')">فيسبوك</button>
      <button onclick="shareTo('x','${escapeHtml(shareUrl)}','${escapeHtml(x.title)}')">X</button>
      <button onclick="shareTo('copy','${escapeHtml(shareUrl)}','${escapeHtml(x.title)}')">📋 نسخ الرابط</button>
    </div>`;

  if(!current){
    $('#messageSellerBtn').onclick=()=>openConversationWith(owner,x);
    $('#reportListingBtn').onclick=()=>openReport('listing',x.id);
    $('#blockSellerBtn').onclick=()=>blockUser(owner);
    $('#requestDeliveryBtn').onclick=()=>requestDelivery(x);
    $('#rateSellerBtn').onclick=()=>openRating(owner,x.id);
  }
  $('#modalFavoriteBtn').onclick=()=>toggleFavorite(x.id);
  if(current||isAdmin)$('#deleteListingBtn').onclick=async()=>{if(confirm('هل أنت متأكد من حذف الإعلان؟')){await deleteDoc(doc(db,'listings',x.id));toast('تم حذف الإعلان 🗑️');closeModal();}};

  if(allImages.length>1){
    $$('.gallery-thumbs img').forEach(th=>th.onclick=()=>{
      $$('.gallery-thumbs img').forEach(i=>i.classList.remove('active'));
      th.classList.add('active');
      $('#galleryMain').innerHTML=`<img src="${escapeHtml(cloudinaryUrl(th.dataset.full,1000,800))}" alt="">`;
    });
  }
  $('#listingModal').hidden=false;
}

function closeModal(){$('#listingModal').hidden=true;}

window.shareTo=function(platform,url,title){
  const text=`شوف هاذ الإعلان على سوق الجزائر: ${title}`;
  if(platform==='whatsapp')window.open(`https://wa.me/?text=${encodeURIComponent(text+' '+url)}`,'_blank');
  else if(platform==='facebook')window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,'_blank');
  else if(platform==='x')window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,'_blank');
  else if(platform==='copy'){navigator.clipboard?.writeText(url);toast('تم نسخ الرابط 📋');}
};

function openRating(targetUid,listingId){
  if(!requireLogin())return;
  $('#ratingTargetUid').value=targetUid;
  $('#ratingTargetId').value=listingId;
  $('#ratingValue').value='';
  $$('#starRating button').forEach(b=>b.classList.remove('active'));
  $('#ratingModal').hidden=false;
}
function closeRating(){$('#ratingModal').hidden=true;}

async function submitRating(e){
  e.preventDefault();if(!requireLogin())return;
  const targetUid=$('#ratingTargetUid').value,listingId=$('#ratingTargetId').value;
  const rating=Number($('#ratingValue').value);
  const comment=e.target.comment.value.trim();
  if(!rating||rating<1||rating>5){toast('اختار عدد النجوم ⭐');return;}
  try{
    await addDoc(collection(db,'ratings'),{raterUid:currentUser.uid,targetUid,listingId,rating,comment,createdAt:serverTimestamp()});
    await updateDoc(doc(db,'listings',listingId),{ratingCount:increment(1),ratingSum:increment(rating)});
    toast('تم إرسال التقييم ⭐');closeRating();
  }catch(e){toast('تعذر إرسال التقييم.');}
}

async function ensureUserProfile(user){
  const ref=doc(db,'users',user.uid),snap=await getDoc(ref);
  if(!snap.exists()){
    const p={uid:user.uid,displayName:user.displayName||'مستخدم',email:user.email||'',photoURL:user.photoURL||'',role:'user',favoriteIds:[],verified:false,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
    await setDoc(ref,p);return p;
  }
  const d=snap.data();
  await setDoc(ref,{displayName:user.displayName||d.displayName||'مستخدم',email:user.email||d.email||'',photoURL:user.photoURL||d.photoURL||'',updatedAt:serverTimestamp()},{merge:true});
  return{...d,uid:user.uid};
}

function updateAccountUI(){
  const login=$('#firebaseLogin'),logout=$('#firebaseLogout'),name=$('#accountName'),status=$('#accountStatus'),avatar=$('#accountAvatar');
  if(!currentUser){login.hidden=false;logout.hidden=true;name.textContent='زائر';status.textContent='سجّل الدخول باش تنشر إعلانات وتحفظ المفضلة.';avatar.textContent='👤';return;}
  login.hidden=true;logout.hidden=false;
  name.textContent=currentProfile?.displayName||currentUser.displayName||'مستخدم';
  status.textContent=isAdmin?'🛡️ حساب إدارة':(currentProfile?.verified?'✓ حساب موثّق':'حساب عضو');
  avatar.innerHTML=currentUser.photoURL?`<img src="${escapeHtml(currentUser.photoURL)}" alt="" style="width:72px;height:72px;border-radius:50%;object-fit:cover">`:'👤';
}

async function loginGoogle(){try{await signInWithPopup(auth,googleProvider);toast('تم تسجيل الدخول بنجاح ✅');}catch(e){if(e.code!=='auth/popup-closed-by-user')toast('تعذر تسجيل الدخول: '+(e.code||'خطأ'));}}
async function logout(){try{await signOut(auth);toast('تم تسجيل الخروج 👋');}catch(e){toast('تعذر تسجيل الخروج');}}

function validUrl(url){if(!url)return true;try{const u=new URL(url);return['http:','https:'].includes(u.protocol);}catch{return false;}}

function initImageUpload(){
  const input=$('#imageFileInput');if(!input)return;
  input.onchange=async()=>{
    currentImages=[];const grid=$('#imagePreviewGrid');grid.innerHTML='';
    if(!input.files.length)return;
    showLoading(true);
    try{
      for(const file of input.files){
        const url=await uploadImageToCloudinary(file);
        if(url){currentImages.push(url);const div=document.createElement('div');div.className='image-preview';div.innerHTML=`<img src="${escapeHtml(url)}"><button class="remove-img" data-url="${escapeHtml(url)}">×</button>`;grid.appendChild(div);}
      }
      $$('.remove-img').forEach(b=>b.onclick=()=>{currentImages=currentImages.filter(u=>u!==b.dataset.url);b.parentElement.remove();});
    }catch(err){toast(err.message);}
    showLoading(false);
  };
}

function getAiSuggestions(title='',desc=''){
  const text=(title+' '+desc).toLowerCase();
  const suggestions=[];
  for(const[key,cat]of Object.entries(AI_CATEGORY_HINTS)){if(text.includes(key)){suggestions.push({type:'category',value:cat});break;}}
  const hasSpam=SPAM_WORDS.some(w=>text.includes(w));
  if(hasSpam)suggestions.push({type:'warning',value:'⚠️ المحتوى يحتوي على كلمات مشبوهة. راجع قبل النشر.'});
  if(title.length<10)suggestions.push({type:'title',value:'أضف تفاصيل أكثر في العنوان (مثال: iPhone 13 128GB أزرق)'});
  if(desc.length<30)suggestions.push({type:'desc',value:'الوصف قصير. أضف المواصفات والحالة والعيوب.'});
  return suggestions;
}

function showAiSuggestions(){
  const title=$('#postTitle')?.value||'',desc=$('#postDesc')?.value||'';
  const box=$('#aiSuggestions'),chips=$('#aiChips');if(!box||!chips)return;
  const suggestions=getAiSuggestions(title,desc);
  if(!suggestions.length){box.hidden=true;return;}
  box.hidden=false;
  chips.innerHTML=suggestions.map(s=>`<button type="button" class="ai-chip" data-type="${s.type}" data-value="${escapeHtml(s.value)}">${escapeHtml(s.value)}</button>`).join('');
  $$('.ai-chip').forEach(c=>c.onclick=()=>{if(c.dataset.type==='category')$('#postCategory').value=c.dataset.value;else if(c.dataset.type==='title')$('#postTitle').value=c.dataset.value;else if(c.dataset.type==='desc')$('#postDesc').value=c.dataset.value;});
}

async function submitListing(e){
  e.preventDefault();if(!requireLogin())return;
  const f=new FormData(e.target),title=String(f.get('title')||'').trim(),price=Number(f.get('price'));
  if(!title||!Number.isFinite(price)||price<0){toast('راجع العنوان والسعر');return;}
  const text=(title+' '+String(f.get('description')||'')).toLowerCase();
  if(SPAM_WORDS.some(w=>text.includes(w))){toast('⚠️ الإعلان يحتوي على كلمات غير مسموح بها. راجع المحتوى.');return;}
  const dup=listings.find(l=>l.title.toLowerCase()===title.toLowerCase()&&l.ownerUid===currentUser.uid);
  if(dup){toast('⚠️ عندك إعلان بنفس العنوان. حدّثه بدل ما تنشر جديد.');return;}
  let images=[...currentImages];
  const urlInput=String(f.get('imageUrls')||'').trim();
  if(urlInput){const urls=urlInput.split(',').map(u=>u.trim()).filter(u=>validUrl(u));images=images.concat(urls);}
  const item={title,price,category:f.get('category'),wilaya:f.get('wilaya'),city:String(f.get('city')||'').trim(),condition:f.get('condition'),delivery:f.get('delivery')!=='يد بيد',images:images.slice(0,5),image:images[0]||'',emoji:'🛍️',seller:currentProfile?.displayName||currentUser.displayName||'بائع',sellerVerified:currentProfile?.verified||false,ownerUid:currentUser.uid,description:String(f.get('description')||'').trim(),phone:String(f.get('phone')||'').trim(),showPhone:f.get('showPhone')!==null,status:'published',views:0,ratingCount:0,ratingSum:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  try{await addDoc(collection(db,'listings'),item);e.target.reset();currentImages=[];$('#imagePreviewGrid').innerHTML='';toast('تم نشر الإعلان بنجاح ✅');go('home');}catch(err){console.error(err);toast('فشل نشر الإعلان: '+(err.code||'تحقق من Rules'));}
}

async function submitDriver(e){
  e.preventDefault();if(!requireLogin())return;
  const f=new FormData(e.target),birth=new Date(f.get('birth')),age=(Date.now()-birth.getTime())/(365.25*24*3600*1000);
  if(!Number.isFinite(age)||age<18){toast('لازم تكون 18 سنة أو أكثر');return;}
  const item={ownerUid:currentUser.uid,name:String(f.get('name')||'').trim(),birthDate:String(f.get('birth')),phone:String(f.get('phone')||'').trim(),wilaya:f.get('wilaya'),vehicle:f.get('vehicle'),vehicleNumber:String(f.get('vehicleNumber')||'').trim(),status:'pending',verified:false,activityStatus:'offline',lastSeenAt:serverTimestamp(),rating:null,rides:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  try{await addDoc(collection(db,'drivers'),item);e.target.reset();toast('تم إرسال طلب المراجعة إلى الإدارة 🛡️');}catch(err){console.error(err);toast('فشل إرسال طلب الموصّل');}
}

function renderDrivers(){
  const el=$('#driverGrid');if(!el)return;
  el.innerHTML=drivers.length?drivers.map(d=>{const st=statusMeta(d);return`<article class="driver"><div class="driver-head"><h3>${escapeHtml(d.name||'موصّل')} ${d.verified?'<span class="verified">✓ موثّق</span>':''}</h3><span class="status-dot ${st.s}">${st.label}</span></div><div class="meta">🚗 ${escapeHtml(d.vehicle||'مركبة')} • 📍 ${escapeHtml(d.wilaya||'')}</div><div class="activity-label">🕒 آخر ظهور: ${escapeHtml(st.lastSeen)}</div></article>`}).join(''):'<div class="empty">ما كاش موصلين موثّقين حالياً.</div>';
  const homeEl=$('#homeDrivers');if(homeEl){const activeDrivers=drivers.filter(d=>d.activityStatus==='active').slice(0,4);homeEl.innerHTML=activeDrivers.length?activeDrivers.map(d=>{const st=statusMeta(d);return`<article class="driver"><div class="driver-head"><h3>${escapeHtml(d.name||'موصّل')} ${d.verified?'<span class="verified">✓ موثّق</span>':''}</h3><span class="status-dot ${st.s}">${st.label}</span></div><div class="meta">🚗 ${escapeHtml(d.vehicle||'مركبة')} • 📍 ${escapeHtml(d.wilaya||'')}</div></article>`}).join(''):'<div class="empty small-empty">ما كاش موصلين نشطين حالياً.</div>';}
}

function renderMyDriver(){
  const el=$('#myDriverStatus');if(!el)return;
  if(!myDriver||myDriver.status!=='approved'||!myDriver.verified){el.hidden=true;return;}
  el.hidden=false;const st=statusMeta(myDriver);
  el.innerHTML=`<div class="status-line"><div><b>حالة حسابك كموصّل</b><div class="status-dot ${st.s}">${st.label}</div><div class="activity-label">🕒 آخر ظهور: ${escapeHtml(st.lastSeen)}</div></div><div class="muted">آخر نشاط يتم تحديثه تلقائياً</div></div>
  <div class="driver-status-actions"><button class="small-btn" data-driver-status="active">🟢 متصل الآن</button><button class="small-btn" data-driver-status="busy">🟠 مشغول</button><button class="small-btn" data-driver-status="offline">⚫ غير متصل</button></div>`;
  $$('[data-driver-status]').forEach(b=>b.onclick=()=>setDriverStatus(b.dataset.driverStatus));
}

async function setDriverStatus(status){if(!myDriver||!requireLogin())return;try{await updateDoc(doc(db,'drivers',myDriver.id),{activityStatus:status,lastSeenAt:serverTimestamp(),updatedAt:serverTimestamp()});toast(status==='active'?'أنت متصل الآن 🟢':status==='busy'?'تم وضعك مشغول 🟠':'تم وضعك غير متصل ⚫');}catch(e){toast('تعذر تغيير الحالة.');}}
async function heartbeat(){if(!currentUser||!myDriver||myDriver.status!=='approved'||!myDriver.verified)return;if(myDriver.activityStatus==='offline')return;try{await updateDoc(doc(db,'drivers',myDriver.id),{lastSeenAt:serverTimestamp(),activityStatus:myDriver.activityStatus||'active'});}catch{}}

async function requestDelivery(listing){
  if(!requireLogin())return;
  const available=drivers.filter(d=>d.wilaya===listing.wilaya&&d.activityStatus==='active');
  if(!available.length){toast('ما كاش موصّل نشط حالياً في نفس الولاية.');return;}
  const driver=available[0];
  try{await addDoc(collection(db,'deliveryRequests'),{listingId:listing.id,listingTitle:listing.title,buyerUid:currentUser.uid,sellerUid:listing.ownerUid,driverUid:driver.ownerUid,driverId:driver.id,status:'pending',wilaya:listing.wilaya,timeline:{pending:Date.now()},createdAt:serverTimestamp(),updatedAt:serverTimestamp()});toast('تم إرسال طلب التوصيل 🚚');closeModal();}catch(e){toast('تعذر إرسال طلب التوصيل.');}
}

function renderTracking(){
  const el=$('#trackingList');if(!el)return;
  const myRequests=deliveryRequests.filter(r=>r.buyerUid===currentUser?.uid||r.sellerUid===currentUser?.uid||r.driverUid===currentUser?.uid);
  if(!myRequests.length){el.innerHTML='<div class="empty">ما كاش طلبات توصيل بعد.</div>';return;}
  const statusLabels={pending:'⏳ قيد الانتظار',accepted:'✅ مقبول',pickedup:'📦 تم الاستلام',delivering:'🚚 قيد التوصيل',completed:'✓ مكتمل',cancelled:'✗ ملغى'};
  const statusClasses={pending:'status-pending',accepted:'status-accepted',pickedup:'status-pickedup',delivering:'status-delivering',completed:'status-completed',cancelled:'status-cancelled'};
  const steps=['pending','accepted','pickedup','delivering','completed'];
  el.innerHTML=myRequests.map(r=>{
    const stepIndex=steps.indexOf(r.status);
    return`<div class="tracking-item"><div class="tracking-header"><div><b>${escapeHtml(r.listingTitle||'طلب توصيل')}</b><div class="meta">📍 ${escapeHtml(r.wilaya||'')}</div></div><span class="tracking-status ${statusClasses[r.status]||'status-pending'}">${statusLabels[r.status]||r.status}</span></div>
    <div class="tracking-timeline">${steps.map((s,i)=>`<div class="timeline-step ${i<stepIndex?'done':''} ${i===stepIndex&&r.status!=='cancelled'?'active':''}" title="${statusLabels[s]}"></div>`).join('')}</div>
    ${r.driverUid===currentUser?.uid&&r.status!=='completed'&&r.status!=='cancelled'?`<div class="admin-item-actions" style="margin-top:10px">
      ${r.status==='pending'?`<button class="small-btn success" onclick="updateDeliveryStatus('${r.id}','accepted')">قبول</button>`:''}
      ${r.status==='accepted'?`<button class="small-btn" onclick="updateDeliveryStatus('${r.id}','pickedup')">تم الاستلام</button>`:''}
      ${r.status==='pickedup'?`<button class="small-btn" onclick="updateDeliveryStatus('${r.id}','delivering')">بدأ التوصيل</button>`:''}
      ${r.status==='delivering'?`<button class="small-btn success" onclick="updateDeliveryStatus('${r.id}','completed')">تم التسليم</button>`:''}
      <button class="small-btn danger" onclick="updateDeliveryStatus('${r.id}','cancelled')">إلغاء</button>
    </div>`:''}</div>`;
  }).join('');
}

window.updateDeliveryStatus=async function(id,status){
  try{await updateDoc(doc(db,'deliveryRequests',id),{status,[`timeline.${status}`]:Date.now(),updatedAt:serverTimestamp()});toast('تم تحديث الحالة ✅');}catch(e){toast('تعذر تحديث الحالة.');}
};

function renderMyDeliveries(){
  const card=$('#myDeliveriesCard');if(!card||!currentUser){if(card)card.hidden=true;return;}card.hidden=false;renderTracking();
}

function conversationId(a,b,listingId){return[a,b].sort().join('_')+'_'+String(listingId||'general');}
async function isBlocked(otherUid){if(!currentUser)return false;return!!blocked.find(b=>b.targetUid===otherUid);}

async function openConversationWith(otherUid,listing){
  if(!requireLogin()||otherUid===currentUser.uid)return;
  if(await isBlocked(otherUid)){toast('هذا الحساب محظور عندك.');return;}
  const id=conversationId(currentUser.uid,otherUid,listing?.id||'general');
  const ref=doc(db,'conversations',id),snap=await getDoc(ref);
  if(!snap.exists())await setDoc(ref,{participants:[currentUser.uid,otherUid],participantNames:{[currentUser.uid]:currentProfile?.displayName||'مستخدم',[otherUid]:listing?.seller||'مستخدم'},listingId:listing?.id||null,listingTitle:listing?.title||'',lastMessage:'',lastSenderUid:'',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  activeConversation={id,otherUid,listing};$('#chatTitle').textContent='💬 '+(listing?.title||'محادثة');$('#chatModal').hidden=false;subscribeMessages(id);
}

function subscribeMessages(id){
  if(unsub.messages)unsub.messages();
  unsub.messages=onSnapshot(query(collection(db,'conversations',id,'messages'),orderBy('createdAt','asc'),limit(100)),s=>{
    const el=$('#chatMessages');
    el.innerHTML=s.docs.map(d=>{const x=d.data(),mine=x.senderUid===currentUser?.uid;return`<div class="chat-message ${mine?'mine':''}"><div>${escapeHtml(x.text||'')}</div><small>${mine?'أنت':escapeHtml(x.senderName||'مستخدم')}</small></div>`}).join('')||'<div class="empty">ابدأ المحادثة.</div>';
    el.scrollTop=el.scrollHeight;
  });
}

async function sendMessage(e){
  e.preventDefault();if(!activeConversation||!requireLogin())return;
  const input=$('#chatInput'),text=input.value.trim();if(!text)return;
  if(await isBlocked(activeConversation.otherUid)){toast('المراسلة متوقفة لأن الحساب محظور.');return;}
  try{await addDoc(collection(db,'conversations',activeConversation.id,'messages'),{senderUid:currentUser.uid,senderName:currentProfile?.displayName||currentUser.displayName||'مستخدم',text,createdAt:serverTimestamp()});await updateDoc(doc(db,'conversations',activeConversation.id),{lastMessage:text,lastSenderUid:currentUser.uid,updatedAt:serverTimestamp()});input.value='';}catch(e){toast('تعذر إرسال الرسالة.');}
}

function closeChat(){$('#chatModal').hidden=true;activeConversation=null;if(unsub.messages)unsub.messages();}

function renderConversations(){
  const el=$('#conversationList');if(!el)return;
  if(!currentUser){el.innerHTML='<div class="empty small-empty">سجّل الدخول باش تشوف محادثاتك.</div>';return;}
  el.innerHTML=conversations.length?conversations.map(c=>`<div class="conversation-item" data-conv="${escapeHtml(c.id)}"><b>${escapeHtml(c.listingTitle||'محادثة')}</b><div class="meta">${escapeHtml(c.lastMessage||'لا توجد رسائل بعد')}</div></div>`).join(''):'<div class="empty small-empty">ما كاش محادثات بعد.</div>';
  $$('[data-conv]').forEach(x=>x.onclick=()=>{const c=conversations.find(z=>z.id===x.dataset.conv);if(!c)return;const other=c.participants.find(p=>p!==currentUser.uid);openConversationWith(other,{id:c.listingId,title:c.listingTitle,seller:c.participantNames?.[other]});});
}

function renderBlocked(){
  const el=$('#blockedList');if(!el)return;
  el.innerHTML=blocked.length?blocked.map(b=>`<div class="blocked-item"><b>${escapeHtml(b.targetName||'حساب')}</b><button class="small-btn" data-unblock="${escapeHtml(b.targetUid)}">إلغاء الحظر</button></div>`).join(''):'<div class="empty small-empty">ما كاش حسابات محظورة.</div>';
  $$('[data-unblock]').forEach(b=>b.onclick=()=>unblockUser(b.dataset.unblock));
}

async function blockUser(uid){
  if(!requireLogin()||uid===currentUser.uid)return;
  const id=currentUser.uid+'_'+uid;
  try{await setDoc(doc(db,'blocks',id),{blockerUid:currentUser.uid,targetUid:uid,targetName:listings.find(x=>x.ownerUid===uid)?.seller||'حساب',createdAt:serverTimestamp()});toast('تم حظر الحساب 🚫');closeModal();}catch(e){toast('تعذر حظر الحساب.');}
}
async function unblockUser(uid){try{await deleteDoc(doc(db,'blocks',currentUser.uid+'_'+uid));toast('تم إلغاء الحظر.');}catch(e){toast('تعذر إلغاء الحظر.');}}

function openReport(type,id){if(!requireLogin())return;$('#reportTargetId').value=id;$('#reportTargetType').value=type;$('#reportModal').hidden=false;}
function closeReport(){$('#reportModal').hidden=true;}
async function submitReport(e){
  e.preventDefault();if(!requireLogin())return;
  try{await addDoc(collection(db,'reports'),{reporterUid:currentUser.uid,targetType:$('#reportTargetType').value,targetId:$('#reportTargetId').value,reason:$('#reportReason').value,details:$('#reportDetails').value.trim(),status:'open',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});toast('تم إرسال البلاغ للإدارة 🚩');closeReport();}catch(e){toast('تعذر إرسال البلاغ.');}
}

async function submitPromotion(e){
  e.preventDefault();if(!requireLogin())return;
  const f=new FormData(e.target);
  let imageUrl='';
  const file=$('#promoImageInput');
  if(file?.files.length){try{imageUrl=await uploadImageToCloudinary(file.files[0]);}catch(err){toast(err.message);return;}}
  const item={ownerUid:currentUser.uid,name:String(f.get('name')||'').trim(),type:f.get('type'),wilaya:f.get('wilaya'),url:String(f.get('url')||'').trim(),description:String(f.get('description')||'').trim(),image:imageUrl,status:'pending',createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  try{await addDoc(collection(db,'promotions'),item);e.target.reset();toast('تم إرسال طلب الترويج للمراجعة 📣');}catch(err){toast('فشل إرسال الترويج.');}
}

function renderPromotions(){
  const el=$('#promoGrid');if(!el)return;
  const approved=promotions.filter(p=>p.status==='approved');
  el.innerHTML=approved.length?approved.map(p=>`<div class="promo-card">${p.image?`<img src="${escapeHtml(cloudinaryUrl(p.image,200,200))}" alt="">`:'<div style="font-size:40px">📣</div>'}<h3>${escapeHtml(p.name)}</h3><div class="meta">${escapeHtml(p.type)} • ${escapeHtml(p.wilaya||'')}</div><p class="muted" style="font-size:12px;margin-top:6px">${escapeHtml(p.description||'')}</p>${p.url?`<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">زيارة الرابط ↗</a>`:''}</div>`).join(''):'<div class="empty">ما كاش ترويجات معتمدة حالياً.</div>';
}

async function renderProfile(uid){
  const userDoc=await getDoc(doc(db,'users',uid));
  const userData=userDoc.exists()?userDoc.data():{};
  $('#profileName').textContent=userData.displayName||'مستخدم';
  $('#profileDisplayName').textContent=userData.displayName||'مستخدم';
  $('#profileMeta').textContent=(userData.verified?'✓ حساب موثّق • ':'')+'عضو منذ '+formatDate(userData.createdAt);
  $('#profileAvatar').innerHTML=userData.photoURL?`<img src="${escapeHtml(userData.photoURL)}" alt="">`:'👤';
  const userListings=listings.filter(l=>l.ownerUid===uid);
  $('#profileStats').innerHTML=`<div><b>${userListings.length}</b><span>إعلان</span></div><div><b>${userData.ratingCount||0}</b><span>تقييم</span></div>`;
  renderListings(userListings,'#profileListings');
}

function renderMyListings(){
  const card=$('#myListingsCard');if(!card||!currentUser){if(card)card.hidden=true;return;}card.hidden=false;
  const myListings=listings.filter(l=>l.ownerUid===currentUser.uid);
  renderListings(myListings,'#myListingsGrid');
}

function subscribeData(){
  if(unsub.listings)unsub.listings();
  unsub.listings=onSnapshot(query(collection(db,'listings'),where('status','==','published'),orderBy('createdAt','desc'),limit(80)),s=>{listings=s.docs.map(d=>({id:d.id,...d.data()}));renderAll();if($('#searchView').classList.contains('active'))applyFilters();},e=>{console.error(e);toast('تعذر قراءة الإعلانات.');});
  if(unsub.drivers)unsub.drivers();
  unsub.drivers=onSnapshot(query(collection(db,'drivers'),where('status','==','approved'),where('verified','==',true)),s=>{const now=Date.now();drivers=s.docs.map(d=>{const x={id:d.id,...d.data()};const seen=x.lastSeenAt?.toMillis?.()||0;if(x.activityStatus==='active'&&seen&&now-seen>150000)x.activityStatus='offline';return x;});renderDrivers();renderMyDriver();$('#statDrivers').textContent=drivers.length;},e=>console.error(e));
  if(unsub.promotions)unsub.promotions();
  unsub.promotions=onSnapshot(query(collection(db,'promotions'),where('status','==','approved'),orderBy('createdAt','desc'),limit(20)),s=>{promotions=s.docs.map(d=>({id:d.id,...d.data()}));renderPromotions();},e=>console.error(e));
}

function subscribeMine(){
  if(!currentUser)return;
  if(unsub.myDriver)unsub.myDriver();
  unsub.myDriver=onSnapshot(query(collection(db,'drivers'),where('ownerUid','==',currentUser.uid),limit(1)),s=>{myDriver=s.docs[0]?{id:s.docs[0].id,...s.docs[0].data()}:null;renderMyDriver();},e=>console.error(e));
  if(unsub.conversations)unsub.conversations();
  unsub.conversations=onSnapshot(query(collection(db,'conversations'),where('participants','array-contains',currentUser.uid),orderBy('updatedAt','desc'),limit(30)),s=>{conversations=s.docs.map(d=>({id:d.id,...d.data()}));renderConversations();},e=>console.error(e));
  if(unsub.blocks)unsub.blocks();
  unsub.blocks=onSnapshot(query(collection(db,'blocks'),where('blockerUid','==',currentUser.uid),limit(100)),s=>{blocked=s.docs.map(d=>({id:d.id,...d.data()}));renderBlocked();},e=>console.error(e));

  // ✅ هذا هو الاستعلام الوحيد الصحيح لطلبات التوصيل (خاص بالمستخدم الحالي فقط)
  if(unsub.deliveryRequests)unsub.deliveryRequests();
  unsub.deliveryRequests=onSnapshot(query(collection(db,'deliveryRequests'),where('buyerUid','==',currentUser.uid),limit(50)),s=>{
    deliveryRequests=s.docs.map(d=>({id:d.id,...d.data()}));
    renderTracking();renderMyDeliveries();
  },e=>console.error(e));
}

async function renderAdmin(){
  if(!isAdmin){$('#adminView .page-heading p').textContent='هذا القسم خاص بالإدارة فقط.';return;}
  $('#adminView .page-heading p').textContent='أنت داخل وضع الإدارة. العمليات الحساسة محمية بقواعد Firestore.';

  $('#adminListings').innerHTML=listings.slice(0,30).map(x=>`<div class="admin-item"><b>${escapeHtml(x.title)}</b><div class="meta">${escapeHtml(x.seller||'')} • ${formatPrice(x.price)}</div><div class="admin-item-actions"><button class="small-btn danger" data-admin-delete-listing="${escapeHtml(x.id)}">حذف</button><button class="small-btn" data-admin-report-listing="${escapeHtml(x.id)}">فتح بلاغ</button></div></div>`).join('')||'<div class="empty">لا توجد إعلانات.</div>';
  $$('[data-admin-delete-listing]').forEach(b=>b.onclick=async()=>{if(confirm('حذف الإعلان؟'))await deleteDoc(doc(db,'listings',b.dataset.adminDeleteListing));});

  const ds=drivers.slice(0,30);
  $('#adminDrivers').innerHTML=ds.map(d=>`<div class="admin-item"><b>${escapeHtml(d.name||'موصل')}</b><div class="meta">${escapeHtml(d.wilaya||'')} • ${escapeHtml(d.status||'')}</div><div class="admin-item-actions">${d.status!=='approved'?`<button class="small-btn success" data-driver-approve="${d.id}">قبول</button>`:''}<button class="small-btn danger" data-driver-reject="${d.id}">إيقاف</button></div></div>`).join('')||'<div class="empty">لا توجد طلبات.</div>';
  $$('[data-driver-approve]').forEach(b=>b.onclick=()=>adminDriver(b.dataset.driverApprove,'approved',true));
  $$('[data-driver-reject]').forEach(b=>b.onclick=()=>adminDriver(b.dataset.driverReject,'rejected',false));

  if(unsub.adminReports)unsub.adminReports();
  unsub.adminReports=onSnapshot(query(collection(db,'reports'),where('status','==','open'),orderBy('createdAt','desc'),limit(50)),s=>{
    const reports=s.docs.map(d=>({id:d.id,...d.data()}));
    $('#statReports').textContent=reports.length;
    $('#adminReports').innerHTML=reports.map(r=>`<div class="admin-item"><b>${escapeHtml(r.reason||'بلاغ')}</b><div class="meta">${escapeHtml(r.targetType||'')} • ${escapeHtml(r.details||'')}</div><div class="admin-item-actions"><button class="small-btn success" data-report-close="${r.id}">إغلاق</button></div></div>`).join('')||'<div class="empty">لا توجد بلاغات مفتوحة.</div>';
    $$('[data-report-close]').forEach(b=>b.onclick=()=>updateDoc(doc(db,'reports',b.dataset.reportClose),{status:'closed',updatedAt:serverTimestamp()}));
  });

  if(unsub.deliveryAdmin)unsub.deliveryAdmin();
  unsub.deliveryAdmin=onSnapshot(query(collection(db,'deliveryRequests'),where('status','==','pending'),limit(50)),s=>$('#statDeliveryRequests').textContent=s.size);

  if(unsub.adminUsers)unsub.adminUsers();
  unsub.adminUsers=onSnapshot(query(collection(db,'users'),orderBy('createdAt','desc'),limit(50)),s=>{
    const us=s.docs.map(d=>({id:d.id,...d.data()}));
    $('#statUsers').textContent=us.length;
    $('#adminUsers').innerHTML=us.map(u=>`<div class="admin-item"><b>${escapeHtml(u.displayName||'مستخدم')}</b><div class="meta">${escapeHtml(u.email||'')} • ${u.role||'user'}</div><div class="admin-item-actions">${u.role!=='admin'?`<button class="small-btn success" data-make-admin="${u.id}">تعيين أدمن</button>`:''}<button class="small-btn danger" data-verify-user="${u.id}">${u.verified?'إلغاء توثيق':'توثيق'}</button></div></div>`).join('')||'<div class="empty">لا يوجد مستخدمون.</div>';
    $$('[data-make-admin]').forEach(b=>b.onclick=()=>updateDoc(doc(db,'users',b.dataset.makeAdmin),{role:'admin',updatedAt:serverTimestamp()}));
    $$('[data-verify-user]').forEach(b=>b.onclick=async()=>{const ref=doc(db,'users',b.dataset.verifyUser);const snap=await getDoc(ref);const v=snap.data()?.verified;updateDoc(ref,{verified:!v,updatedAt:serverTimestamp()});});
  });

  if(unsub.adminPromotions)unsub.adminPromotions();
  unsub.adminPromotions=onSnapshot(query(collection(db,'promotions'),where('status','==','pending'),orderBy('createdAt','desc'),limit(30)),s=>{
    const pr=s.docs.map(d=>({id:d.id,...d.data()}));
    $('#statPromotions').textContent=pr.length;
    $('#adminPromotions').innerHTML=pr.map(p=>`<div class="admin-item"><b>${escapeHtml(p.name)}</b><div class="meta">${escapeHtml(p.type||'')} • ${escapeHtml(p.wilaya||'')}</div><div class="admin-item-actions"><button class="small-btn success" data-promo-approve="${p.id}">قبول</button><button class="small-btn danger" data-promo-reject="${p.id}">رفض</button></div></div>`).join('')||'<div class="empty">لا توجد ترويجات قيد المراجعة.</div>';
    $$('[data-promo-approve]').forEach(b=>b.onclick=()=>updateDoc(doc(db,'promotions',b.dataset.promoApprove),{status:'approved',updatedAt:serverTimestamp()}));
    $$('[data-promo-reject]').forEach(b=>b.onclick=()=>updateDoc(doc(db,'promotions',b.dataset.promoReject),{status:'rejected',updatedAt:serverTimestamp()}));
  });

  const aiAlerts=[];
  listings.slice(0,20).forEach(l=>{
    const text=(l.title+' '+(l.description||'')).toLowerCase();
    if(SPAM_WORDS.some(w=>text.includes(w)))aiAlerts.push(`⚠️ إعلان مشبوه: "${l.title}"`);
    const dup=listings.filter(x=>x.id!==l.id&&x.title.toLowerCase()===l.title.toLowerCase());
    if(dup.length)aiAlerts.push(`🔁 تكرار محتمل: "${l.title}"`);
  });
  $('#aiAdminAlerts').innerHTML=aiAlerts.length?aiAlerts.map(a=>`<div class="admin-item" style="border-color:var(--warning)"><div class="meta">${escapeHtml(a)}</div></div>`).join(''):'<div class="empty small-empty">لا توجد تنبيهات حالياً.</div>';
}

async function adminDriver(id,status,verified){try{await updateDoc(doc(db,'drivers',id),{status,verified,updatedAt:serverTimestamp()});toast(status==='approved'?'تم قبول الموصل ✅':'تم إيقاف الموصل.');}catch(e){toast('تعذر تحديث الموصل.');}}

$$('[data-view]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.view)));
$('#globalSearch').addEventListener('input',()=>{const has=$('#globalSearch').value.trim();$('#clearSearch').hidden=!has;go('search');applyFilters();});
$('#clearSearch').onclick=()=>{$('#globalSearch').value='';$('#clearSearch').hidden=true;applyFilters();};
$('#heroSearchBtn').onclick=()=>{const q=$('#heroSearch').value.trim();$('#globalSearch').value=q;$('#clearSearch').hidden=!q;go('search');applyFilters();};
$('#heroSearch').addEventListener('keydown',e=>{if(e.key==='Enter')$('#heroSearchBtn').click();});
$$('.quick-links button').forEach(b=>b.onclick=()=>{$('#heroSearch').value=b.dataset.query;$('#heroSearchBtn').click();});
['#filterCategory','#filterWilaya','#filterCondition','#minPrice','#maxPrice','#filterDelivery','#sortResults'].forEach(id=>$(id)?.addEventListener('input',applyFilters));
$('#filterCity')?.addEventListener('input',applyFilters);
$('#filterVerified')?.addEventListener('change',applyFilters);
$('#resetFilters').onclick=()=>{$('#filterCategory').value='';$('#filterWilaya').value='';$('#filterCondition').value='';$('#minPrice').value='';$('#maxPrice').value='';$('#filterDelivery').checked=false;if($('#filterCity'))$('#filterCity').value='';if($('#filterVerified'))$('#filterVerified').checked=false;applyFilters();};
$('#postForm')?.addEventListener('submit',submitListing);
$('#driverForm')?.addEventListener('submit',submitDriver);
$('#chatForm')?.addEventListener('submit',sendMessage);
$('#reportForm')?.addEventListener('submit',submitReport);
$('#ratingForm')?.addEventListener('submit',submitRating);
$('#promoForm')?.addEventListener('submit',submitPromotion);
$('#firebaseLogin').onclick=loginGoogle;
$('#firebaseLogout').onclick=logout;
$$('[data-close-modal]').forEach(x=>x.addEventListener('click',closeModal));
$$('[data-close-chat]').forEach(x=>x.addEventListener('click',closeChat));
$$('[data-close-report]').forEach(x=>x.addEventListener('click',closeReport));
$$('[data-close-rating]').forEach(x=>x.addEventListener('click',closeRating));
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();closeChat();closeReport();closeRating();}});

$$('#starRating button').forEach(btn=>{
  btn.onclick=()=>{
    const val=btn.dataset.star;
    $('#ratingValue').value=val;
    $$('#starRating button').forEach(b=>b.classList.toggle('active',Number(b.dataset.star)<=Number(val)));
  };
});

$('#postTitle')?.addEventListener('input',showAiSuggestions);
$('#postDesc')?.addEventListener('input',showAiSuggestions);

categoryCards('#categoryGrid');
categoryCards('#allCategoryGrid');
selectOptions();
initImageUpload();
initDarkMode();
setFirebaseState('Firebase: جاري التحقق...',true);
subscribeData();

setInterval(heartbeat,60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)heartbeat();});

onAuthStateChanged(auth,async user=>{
  currentUser=user;
  if(user){
    try{
      currentProfile=await ensureUserProfile(user);
      isAdmin=currentProfile?.role==='admin';
      favorites=Array.isArray(currentProfile?.favoriteIds)?currentProfile.favoriteIds:[];
      setFirebaseState('Firebase + Google Auth: متصل ✅',true);
      subscribeMine();
    }catch(e){console.error(e);currentProfile=null;isAdmin=false;favorites=[];setFirebaseState('Firebase: تحقق من Rules',false);}
  }else{
    currentProfile=null;isAdmin=false;favorites=[];myDriver=null;conversations=[];blocked=[];
    setFirebaseState('Firebase: متصل، لم يتم تسجيل الدخول.',true);
    Object.values(unsub).forEach(fn=>typeof fn==='function'&&fn());
    unsub={};
  }
  updateAccountUI();
  renderAll();
  renderConversations();
  renderBlocked();
  renderMyDriver();
  renderMyListings();
  renderMyDeliveries();
  if(isAdmin)renderAdmin();
});

window.addEventListener('load',handleUrlParams);

if('serviceWorker'in navigator){
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}

function renderAll(){
  renderListings(listings.slice(0,8),'#homeListings');
  renderFavorites();
  renderDrivers();
  $('#favBadge').textContent=favorites.length;
  $('#favBadge').hidden=!favorites.length;
  $('#statListings').textContent=listings.length;
  $('#statDrivers').textContent=drivers.length;
}