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

const SPAM_WORDS = ['احتيال','نصب','مخدرات','سلاح','جنس','إباحي','fake','scam'];

let listings=[], drivers=[], favorites=[], conversations=[], blocked=[];
let promotions=[], deliveryRequests=[];
let currentUser=null, currentProfile=null;
let isAdmin=false, myDriver=null, activeConversation=null;
let unsub={};
let currentImages=[];

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function toast(t){const x=$('#toast');if(!x)return;x.textContent=t;x.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>x.classList.remove('show'),3000);}
function formatPrice(v){return Number(v||0).toLocaleString('fr-DZ')+' دج';}
function setFirebaseState(t,g=false){const x=$('#firebaseState');if(x){x.textContent=t;x.className='notice '+(g?'notice-success':'');}}
function requireLogin(){if(!currentUser){toast('لازم تسجل الدخول أولاً 🔐');go('account');return false;}return true;}

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
  const lastSeen=d.lastSeenAt?new Date(d.lastSeenAt.seconds*1000).toLocaleTimeString('ar-DZ',{hour:'2-digit',minute:'2-digit'}):'';
  return {s,label,lastSeen};
}

function card(x){
  const active=favorites.includes(x.id);
  const img=x.images?.[0]||x.image||'';
  const rating=x.ratingCount?(x.ratingSum/x.ratingCount).toFixed(1):null;
  return `<article class="listing" data-id="${escapeHtml(x.id)}"><div class="listing-img">
  ${img?`<img src="${escapeHtml(cloudinaryUrl(img,600,450))}" alt="${escapeHtml(x.title)}" loading="lazy">`:escapeHtml(x.emoji||'🛍️')}
  <button class="heart ${active?'active':''}" data-fav="${escapeHtml(x.id)}">${active?'♥':'♡'}</button></div>
  <div class="listing-body"><div class="meta">${escapeHtml(x.condition||'متاح')} • ${escapeHtml(x.category)}</div>
  <div class="listing-title">${escapeHtml(x.title)}</div><div class="price">${formatPrice(x.price)}</div>
  <div class="meta">📍 ${escapeHtml(x.wilaya||'الجزائر')} • 👤 ${escapeHtml(x.seller||'بائع')}</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
  ${x.delivery?'<span class="delivery-chip">🚗 توصيل</span>':''}
  ${rating?`<span class="rating-display">⭐ ${rating}</span>`:''}
  </div></div></article>`;
}

function renderListings(items,target){
  const el=$(target);if(!el)return;
  el.innerHTML=items.length?items.map(card).join(''):'<div class="empty">ما لقيناش إعلانات مطابقة.</div>';
  $$(target+' .heart').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleFavorite(b.dataset.fav);});
  $$(target+' .listing').forEach(c=>c.onclick=()=>openListing(c.dataset.id));
}

async function toggleFavorite(id){
  if(!requireLogin())return;
  try{await updateDoc(doc(db,'users',currentUser.uid),{favoriteIds:arrayUnion(id),updatedAt:serverTimestamp()});favorites.push(id);renderAll();toast('تمت الإضافة للمفضلة ❤️');}catch(e){toast('تعذر تحديث المفضلة.');}
}

function renderFavorites(){renderListings(listings.filter(x=>favorites.includes(x.id)),'#favoritesGrid');}

function applyFilters(){
  const q=$('#globalSearch').value.trim().toLowerCase(),cat=$('#filterCategory').value,w=$('#filterWilaya').value;
  const min=Number($('#minPrice').value||0),max=Number($('#maxPrice').value||Infinity);
  const delivery=$('#filterDelivery').checked;
  let arr=listings.filter(x=>{
    const text=`${x.title} ${x.category} ${x.wilaya}`.toLowerCase();
    return(!q||text.includes(q))&&(!cat||x.category===cat)&&(!w||x.wilaya===w)&&Number(x.price)>=min&&Number(x.price)<=max&&(!delivery||x.delivery);
  });
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
  const img=allImages[0]||'';
  $('#modalContent').innerHTML=`<div class="gallery-main">${img?`<img src="${escapeHtml(cloudinaryUrl(img,1000,800))}" alt="">`:'🛍️'}</div>
    <div class="meta">${escapeHtml(x.category)} • ${escapeHtml(x.condition)} • 👁️ ${x.views||0} مشاهدة</div>
    <h2>${escapeHtml(x.title)}</h2><div class="detail-price">${formatPrice(x.price)}</div>
    <div class="meta">📍 ${escapeHtml(x.wilaya)} • 👤 ${escapeHtml(x.seller||'بائع')}</div>
    <p style="margin-top:10px;line-height:1.7">${escapeHtml(x.description||'')}</p>
    ${x.showPhone&&x.phone?`<div class="phone-box"><b>📞 ${escapeHtml(x.phone)}</b></div>`:''}
    <div class="detail-actions">
      ${!current?'<button class="primary" id="messageSellerBtn">💬 مراسلة البائع</button>':''}
      ${!current?'<button class="secondary" id="reportListingBtn">🚩 تبليغ</button>':''}
      <button class="secondary" id="modalFavoriteBtn">${favorites.includes(x.id)?'♥ محفوظ':'♡ حفظ'}</button>
    </div>`;
  if(!current){
    $('#messageSellerBtn').onclick=()=>openConversationWith(owner,x);
    $('#reportListingBtn').onclick=()=>openReport('listing',x.id);
  }
  $('#modalFavoriteBtn').onclick=()=>toggleFavorite(x.id);
  $('#listingModal').hidden=false;
}

function closeModal(){$('#listingModal').hidden=true;}

async function submitListing(e){
  e.preventDefault();if(!requireLogin())return;
  const f=new FormData(e.target),title=String(f.get('title')||'').trim(),price=Number(f.get('price'));
  const text=(title+' '+String(f.get('description')||'')).toLowerCase();
  if(SPAM_WORDS.some(w=>text.includes(w))){toast('⚠️ المحتوى يحتوي على كلمات مشبوهة.');return;}
  let images=[...currentImages];
  const item={title,price,category:f.get('category'),wilaya:f.get('wilaya'),city:String(f.get('city')||'').trim(),condition:f.get('condition'),delivery:f.get('delivery')!=='يد بيد',images:images.slice(0,5),image:images[0]||'',emoji:'🛍️',seller:currentProfile?.displayName||currentUser.displayName||'بائع',sellerVerified:currentProfile?.verified||false,ownerUid:currentUser.uid,description:String(f.get('description')||'').trim(),phone:String(f.get('phone')||'').trim(),showPhone:f.get('showPhone')!==null,status:'published',views:0,ratingCount:0,ratingSum:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  try{await addDoc(collection(db,'listings'),item);e.target.reset();currentImages=[];toast('تم نشر الإعلان بنجاح ✅');}catch(err){toast('فشل نشر الإعلان: '+err.code);}
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
  el.innerHTML=drivers.length?drivers.map(d=>{const st=statusMeta(d);return`<article class="driver"><div class="driver-head"><h3>${escapeHtml(d.name||'موصّل')} ${d.verified?'<span class="verified">✓</span>':''}</h3><span class="status-dot ${st.s}">${st.label}</span></div><div class="meta">🚗 ${escapeHtml(d.vehicle||'مركبة')} • 📍 ${escapeHtml(d.wilaya||'')}</div><div class="activity-label">🕒 ${escapeHtml(st.lastSeen)}</div></article>`}).join(''):'<div class="empty">ما كاش موصلين.</div>';
  const homeEl=$('#homeDrivers');if(homeEl){const activeDrivers=drivers.filter(d=>d.activityStatus==='active').slice(0,4);homeEl.innerHTML=activeDrivers.length?activeDrivers.map(d=>{const st=statusMeta(d);return`<article class="driver"><div class="driver-head"><h3>${escapeHtml(d.name||'موصّل')}</h3><span class="status-dot ${st.s}">${st.label}</span></div></article>`}).join(''):'<div class="empty">ما كاش موصلين نشطين.</div>';}
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
  try{await addDoc(collection(db,'reports'),{reporterUid:currentUser.uid,targetType:$('#reportTargetType').value,targetId:$('#reportTargetId').value,reason:$('#reportReason').value,details:$('#reportDetails').value.trim(),status:'open',createdAt:serverTimestamp()});toast('تم إرسال البلاغ 🚩');closeReport();}catch(e){toast('تعذر إرسال البلاغ');}
}

async function submitPromotion(e){
  e.preventDefault();if(!requireLogin())return;
  const f=new FormData(e.target);
  let imageUrl='';
  const file=$('#promoImageInput');
  if(file?.files.length){imageUrl=await uploadImageToCloudinary(file.files[0]);}
  const item={ownerUid:currentUser.uid,name:String(f.get('name')||'').trim(),type:f.get('type'),wilaya:f.get('wilaya'),url:String(f.get('url')||'').trim(),description:String(f.get('description')||'').trim(),image:imageUrl,status:'pending',createdAt:serverTimestamp()};
  try{await addDoc(collection(db,'promotions'),item);e.target.reset();toast('تم إرسال الترويج 📣');}catch(err){toast('فشل إرسال الترويج');}
}

function renderPromotions(){
  const el=$('#promoGrid');if(!el)return;
  const approved=promotions.filter(p=>p.status==='approved');
  el.innerHTML=approved.length?approved.map(p=>`<div class="promo-card">${p.image?`<img src="${escapeHtml(cloudinaryUrl(p.image,200,200))}" alt="">`:'📣'}<h3>${escapeHtml(p.name)}</h3><div class="meta">${escapeHtml(p.type)}</div>${p.url?`<a href="${escapeHtml(p.url)}" target="_blank">زيارة الرابط ↗</a>`:''}</div>`).join(''):'<div class="empty">ما كاش ترويجات.</div>';
}

async function renderAdmin(){
  if(!isAdmin) return;
  if(document.querySelector('#adminListings')){
    $('#adminListings').innerHTML=listings.slice(0,30).map(x=>`<div class="admin-item"><b>${escapeHtml(x.title)}</b><div class="meta">${formatPrice(x.price)}</div><div class="admin-item-actions"><button class="small-btn danger" onclick="deleteDoc(doc(db,'listings','${x.id}'))">حذف</button></div></div>`).join('');
  }
  if(document.querySelector('#adminDrivers')){
    $('#adminDrivers').innerHTML=drivers.slice(0,30).map(d=>`<div class="admin-item"><b>${escapeHtml(d.name)}</b><div class="meta">${escapeHtml(d.status)}</div><div class="admin-item-actions"><button class="small-btn success" onclick="adminDriver('${d.id}', 'approved', true)">قبول</button><button class="small-btn danger" onclick="adminDriver('${d.id}', 'rejected', false)">رفض</button></div></div>`).join('');
  }
}

function subscribeData(){
  if(unsub.listings)unsub.listings();
  unsub.listings=onSnapshot(query(collection(db,'listings'),where('status','==','published'),orderBy('createdAt','desc'),limit(80)),s=>{listings=s.docs.map(d=>({id:d.id,...d.data()}));renderAll();},e=>console.error(e));
  if(unsub.drivers)unsub.drivers();
  unsub.drivers=onSnapshot(query(collection(db,'drivers'),where('status','==','approved'),where('verified','==',true)),s=>{drivers=s.docs.map(d=>({id:d.id,...d.data()}));renderDrivers();},e=>console.error(e));
  if(unsub.promotions)unsub.promotions();
  unsub.promotions=onSnapshot(query(collection(db,'promotions'),where('status','==','approved'),orderBy('createdAt','desc'),limit(20)),s=>{promotions=s.docs.map(d=>({id:d.id,...d.data()}));renderPromotions();},e=>console.error(e));
}

function subscribeMine(){
  if(!currentUser)return;
  if(isAdmin){
    if(unsub.adminDrivers)unsub.adminDrivers();
    unsub.adminDrivers=onSnapshot(query(collection(db,'drivers'),orderBy('createdAt','desc'),limit(100)),s=>{
      const allDrivers=s.docs.map(d=>({id:d.id,...d.data()}));
      if(document.querySelector('#adminDrivers')){
        $('#adminDrivers').innerHTML=allDrivers.map(d=>`
          <div class="admin-item">
            <b>${escapeHtml(d.name||'موصل')}</b>
            <div class="meta">${escapeHtml(d.wilaya||'')} • ${escapeHtml(d.status||'')}</div>
            <div class="admin-item-actions">
              ${d.status!=='approved'?`<button class="small-btn success" onclick="adminDriver('${d.id}', 'approved', true)">قبول</button>`:''}
              ${d.status!=='rejected'?`<button class="small-btn danger" onclick="adminDriver('${d.id}', 'rejected', false)">رفض</button>`:''}
            </div>
          </div>
        `).join('')||'<div class="empty">لا توجد طلبات.</div>';
      }
    },e=>console.error(e));
  }
  if(unsub.myDriver)unsub.myDriver();
  unsub.myDriver=onSnapshot(query(collection(db,'drivers'),where('ownerUid','==',currentUser.uid),limit(1)),s=>{
    myDriver=s.docs[0]?{id:s.docs[0].id,...s.docs[0].data()}:null;
    renderMyDriver();
  },e=>console.error(e));
  if(unsub.conversations)unsub.conversations();
  unsub.conversations=onSnapshot(query(collection(db,'conversations'),where('participants','array-contains',currentUser.uid),orderBy('updatedAt','desc'),limit(30)),s=>{
    conversations=s.docs.map(d=>({id:d.id,...d.data()}));
    renderConversations();
  },e=>console.error(e));
  if(unsub.blocks)unsub.blocks();
  unsub.blocks=onSnapshot(query(collection(db,'blocks'),where('blockerUid','==',currentUser.uid),limit(100)),s=>{
    blocked=s.docs.map(d=>({id:d.id,...d.data()}));
    renderBlocked();
  },e=>console.error(e));
  if(unsub.deliveryRequests)unsub.deliveryRequests();
  unsub.deliveryRequests=onSnapshot(query(collection(db,'deliveryRequests'),where('buyerUid','==',currentUser.uid),limit(50)),s=>{
    deliveryRequests=s.docs.map(d=>({id:d.id,...d.data()}));
    renderTracking();
  },e=>console.error(e));
}

function renderTracking(){
  const el=$('#trackingList');if(!el)return;
  if(!deliveryRequests.length){el.innerHTML='<div class="empty">ما كاش طلبات توصيل.</div>';return;}
  el.innerHTML=deliveryRequests.map(r=>`<div class="tracking-item"><b>${escapeHtml(r.listingTitle)}</b><span class="tracking-status status-pending">⏳ ${r.status}</span></div>`).join('');
}

function renderConversations(){
  const el=$('#conversationList');if(!el)return;
  if(!currentUser){el.innerHTML='<div class="empty">سجّل الدخول.</div>';return;}
  el.innerHTML=conversations.length?conversations.map(c=>`<div class="conversation-item" data-id="${c.id}"><b>${escapeHtml(c.listingTitle||'محادثة')}</b></div>`).join(''):'<div class="empty">لا محادثات.</div>';
  $$('[data-id]').forEach(x=>x.onclick=()=>{const c=conversations.find(z=>z.id===x.dataset.id);const other=c?.participants?.find(p=>p!==currentUser.uid);if(other)openConversationWith(other,c);});
}

function renderBlocked(){
  const el=$('#blockedList');if(!el)return;
  el.innerHTML=blocked.length?blocked.map(b=>`<div class="blocked-item"><b>${escapeHtml(b.targetName)}</b></div>`).join(''):'<div class="empty">لا حسابات محظورة.</div>';
}

function renderMyListings(){
  const el=$('#myListingsGrid');if(!el)return;
  renderListings(listings.filter(l=>l.ownerUid===currentUser?.uid),'#myListingsGrid');
}

function renderMyDeliveries(){
  const el=$('#myDeliveriesList');if(!el)return;
  el.innerHTML=deliveryRequests.length?deliveryRequests.map(r=>`<div class="tracking-item"><b>${escapeHtml(r.listingTitle)}</b></div>`).join(''):'<div class="empty">لا طلبات.</div>';
}

async function openConversationWith(otherUid,listing){
  if(!requireLogin())return;
  const id=[currentUser.uid,otherUid].sort().join('_')+'_'+(listing?.id||'general');
  const ref=doc(db,'conversations',id);
  if(!(await getDoc(ref)).exists())await setDoc(ref,{participants:[currentUser.uid,otherUid],listingId:listing?.id||null,listingTitle:listing?.title||'',lastMessage:'',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  activeConversation={id,otherUid,listing};
  $('#chatTitle').textContent='💬 '+(listing?.title||'محادثة');
  $('#chatModal').hidden=false;
  if(unsub.messages)unsub.messages();
  unsub.messages=onSnapshot(query(collection(db,'conversations',id,'messages'),orderBy('createdAt','asc'),limit(100)),s=>{$('#chatMessages').innerHTML=s.docs.map(d=>`<div class="chat-message ${d.data().senderUid===currentUser.uid?'mine':''}">${escapeHtml(d.data().text)}</div>`).join('');});
}

async function sendMessage(e){
  e.preventDefault();if(!activeConversation||!requireLogin())return;
  const text=$('#chatInput').value.trim();if(!text)return;
  try{await addDoc(collection(db,'conversations',activeConversation.id,'messages'),{senderUid:currentUser.uid,text,createdAt:serverTimestamp()});$('#chatInput').value='';}catch(e){toast('تعذر إرسال الرسالة');}
}

function openReport(type,id){if(!requireLogin())return;$('#reportTargetId').value=id;$('#reportTargetType').value=type;$('#reportModal').hidden=false;}
function closeReport(){$('#reportModal').hidden=true;}

async function ensureUserProfile(user){
  const ref=doc(db,'users',user.uid),snap=await getDoc(ref);
  if(!snap.exists()){
    const p={uid:user.uid,displayName:user.displayName||'مستخدم',email:user.email||'',photoURL:user.photoURL||'',role:'user',verified:false,createdAt:serverTimestamp()};
    await setDoc(ref,p);return p;
  }
  return {...snap.data(),uid:user.uid};
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

$$('[data-view]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.view)));
$('#globalSearch').addEventListener('input',()=>{go('search');applyFilters();});
$('#heroSearchBtn').onclick=()=>{const q=$('#heroSearch').value.trim();$('#globalSearch').value=q;go('search');applyFilters();};
$('#postForm').addEventListener('submit',submitListing);
$('#driverForm').addEventListener('submit',submitDriver);
$('#chatForm').addEventListener('submit',sendMessage);
$('#reportForm').addEventListener('submit',submitReport);
$('#promoForm').addEventListener('submit',submitPromotion);
$('#firebaseLogin').onclick=loginGoogle;
$('#firebaseLogout').onclick=()=>signOut(auth);
$$('[data-close-modal]').forEach(x=>x.addEventListener('click',closeModal));
$$('[data-close-chat]').forEach(x=>x.addEventListener('click',()=>{$('#chatModal').hidden=true;activeConversation=null;}));
$$('[data-close-report]').forEach(x=>x.addEventListener('click',closeReport));
$$('[data-close-rating]').forEach(x=>x.addEventListener('click',()=>{$('#ratingModal').hidden=true;}));

categoryCards('#categoryGrid');
categoryCards('#allCategoryGrid');
selectOptions();
initDarkMode();
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
      subscribeMine();
    }catch(e){console.error(e);isAdmin=false;}
  }else{
    currentProfile=null;isAdmin=false;favorites=[];
    setFirebaseState('غير مسجل');
  }
  updateAccountUI();
  renderAll();
  if(isAdmin)renderAdmin();
});

function updateAccountUI(){
  const name=$('#accountName'),status=$('#accountStatus');
  if(!currentUser){$('#firebaseLogin').hidden=false;$('#firebaseLogout').hidden=true;name.textContent='زائر';status.textContent='سجّل الدخول';return;}
  $('#firebaseLogin').hidden=true;$('#firebaseLogout').hidden=false;
  name.textContent=currentProfile?.displayName||currentUser.displayName;
  status.textContent=isAdmin?'🛡️ أدمن':(currentProfile?.verified?'✓ موثّق':'عضو');
}

window.addEventListener('load',()=>{
  const params=new URLSearchParams(window.location.search);
  if(params.get('view')==='listing')openListing(params.get('id'));
});

window.adminDriver = async function(id, status, verified) {
  try {
    await updateDoc(doc(db, 'drivers', id), { status, verified, updatedAt: serverTimestamp() });
    toast(status === 'approved' ? 'تم قبول الموصل ✅' : 'تم إيقاف الموصل.');
  } catch(e) {
    toast('تعذر تحديث الموصل.');
  }
};