// =====================================================
// MarketPas v4 — Müşteri Ekranı
// =====================================================
var marketId=null,sessionId=null,market=null,queueListener=null,myQueueData=null;
var countdownInterval=null,announcementInterval=null,statsInterval=null;
var announcements=[],annIndex=0,notifiedForThisCall=false,currentStats=null;
var isQueueMode=false;
var SPLASH_DURATION=12000;

// ─── Bildirim ────────────────────────────────────────
async function requestNotificationPermission(){if(!('Notification' in window))return;if(Notification.permission==='default')await Notification.requestPermission()}
function notifyCustomer(code,kasaNo){
  if(navigator.vibrate)navigator.vibrate([300,100,300,100,500]);
  try{var ctx=new(window.AudioContext||window.webkitAudioContext)();var o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=880;g.gain.setValueAtTime(.3,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.5);o.start(ctx.currentTime);o.stop(ctx.currentTime+.5)}catch(e){}
  if(Notification.permission==='granted'&&document.hidden)new Notification('Sıranız Geldi!',{body:'Kodunuz: '+code+' — Kasa '+kasaNo+"'e gidiniz",icon:'/icon-192.png',tag:'mp-q',requireInteraction:true});
}

// ─── Başlangıç ───────────────────────────────────────
function init(){
  var p=new URLSearchParams(window.location.search);
  var urlMarket=p.get('market');
  if(!urlMarket){marketId=localStorage.getItem('mp_last_market')}else{marketId=urlMarket}
  if(!marketId){showError('Lütfen marketteki QR kodu telefonunuzla okutun.');return}
  localStorage.setItem('mp_last_market',marketId);
  isQueueMode=!!urlMarket;
  sessionId=localStorage.getItem('mp_s_'+marketId);
  if(!sessionId){sessionId=generateId();localStorage.setItem('mp_s_'+marketId,sessionId)}
  loadMarket();
}

async function loadMarket(){
  showLoading(true);
  try{
    var doc=await db.collection('markets').doc(marketId).get();
    if(!doc.exists){showError('Market bulunamadı.');return}
    market=doc.data();
    applyBranding();
    loadAnnouncements();
    renderCategoryCards();
    if(isQueueMode){
      showSplash(function(){
        updateButtons();
        loadCongestion();
        checkExistingQueue();
        requestNotificationPermission();
        statsInterval=setInterval(loadCongestion,15000);
      });
    }else{
      updateButtons();
      checkExistingQueueSilent();
    }
  }catch(e){showError('Bağlantı hatası. Sayfayı yenileyin.')}
  finally{showLoading(false)}
}

function applyBranding(){
  document.getElementById('hdr-name').textContent=market.name;
  document.title=market.name;
  // PWA manifest
  var icon=market.pwaIconUrl||market.logoUrl||'/icon-192.png';
  var name=market.name||'MarketPas';
  var f=document.getElementById('pwa-icon'),a=document.getElementById('pwa-apple-icon');
  if(f)f.href=icon;if(a)a.href=icon;
  var m={name:name,short_name:name.substring(0,12),start_url:'/musteri.html',display:'standalone',background_color:'#0a0f1a',theme_color:'#10e5b0',orientation:'portrait',icons:[{src:icon,sizes:'192x192',type:'image/png',purpose:'any maskable'},{src:icon,sizes:'512x512',type:'image/png',purpose:'any maskable'}]};
  var old=document.querySelector('link[rel="manifest"]');if(old)old.remove();
  var lnk=document.createElement('link');lnk.rel='manifest';lnk.href=URL.createObjectURL(new Blob([JSON.stringify(m)],{type:'application/json'}));document.head.appendChild(lnk);
}

// ═══ BUTON DURUMLARI ═════════════════════════════════
// Akış:
// 1. Vitrin (markette değil): QR AKTİF, Sıra PASİF
// 2. QR okuttu (markete girdi): QR PASİF, Sıra AKTİF
// 3. Sıra aldı/kod üretildi: QR PASİF, Sıra PASİF
// 4. İşlem bitti: QR AKTİF, Sıra PASİF (vitrine döner)
function updateButtons(){
  var qrBtn=document.getElementById('btn-qr');
  var siraBtn=document.getElementById('btn-sira');
  if(!qrBtn||!siraBtn)return;

  var status=myQueueData?myQueueData.status:null;
  var inQueue=status&&['waiting','priority','priority_ready','called','arrived','active'].indexOf(status)>-1;

  // QR butonu: sadece markette değilken aktif
  qrBtn.disabled=isQueueMode;
  qrBtn.classList.toggle('passive',isQueueMode);

  // Sıra butonu: sadece markette VE henüz sıra almamışken aktif
  siraBtn.disabled=!(isQueueMode&&!inQueue);
}

// ═══ SPLASH ═════════════════════════════════════════
function showSplash(cb){
  var key='mp_w_'+marketId;
  var last=localStorage.getItem(key);
  if(last&&(Date.now()-parseInt(last))<600000){if(cb)cb();return}
  var el=document.getElementById('splash'),bg=document.getElementById('splash-bg');
  var nameEl=document.getElementById('splash-name'),fill=document.getElementById('splash-fill');
  nameEl.textContent=market.name;
  if(market.welcomeImageUrl){bg.style.backgroundImage='url('+market.welcomeImageUrl+')';bg.style.backgroundSize='cover';bg.style.backgroundPosition='center'}
  el.style.display='flex';
  localStorage.setItem(key,Date.now().toString());
  var t=0,iv=setInterval(function(){t+=100;fill.style.width=Math.min(100,t/SPLASH_DURATION*100)+'%';
    if(t>=SPLASH_DURATION){clearInterval(iv);closeSplash(el,cb)}},100);
  el.onclick=function(){clearInterval(iv);closeSplash(el,cb)};
}
function closeSplash(el,cb){el.style.opacity='0';el.style.transition='opacity .4s';setTimeout(function(){el.style.display='none';el.style.opacity='1';el.style.transition='';el.onclick=null;if(cb)cb()},400)}

// ═══ MOD GEÇİŞLERİ ═════════════════════════════════
function enterQueueMode(){isQueueMode=true;updateButtons()}
function enterVitrinMode(){
  isQueueMode=false;
  document.getElementById('q-panel').classList.add('hidden');
  updateButtons();
}

function toggleQueuePanel(){
  var panel=document.getElementById('q-panel');
  if(panel.classList.contains('hidden')){
    panel.classList.remove('hidden');
    if(!statsInterval){loadCongestion();statsInterval=setInterval(loadCongestion,15000)}
    checkExistingQueue();requestNotificationPermission();
  }else{
    var s=myQueueData?myQueueData.status:null;
    var inQ=s&&['waiting','priority','priority_ready','called','arrived','active'].indexOf(s)>-1;
    if(!inQ)panel.classList.add('hidden');
  }
  updateButtons();
}

async function checkExistingQueueSilent(){
  try{var doc=await db.collection('queue').doc(sessionId).get();
    if(doc.exists){var s=doc.data().status;
      if(['waiting','priority','priority_ready','called','arrived','active'].includes(s)){
        enterQueueMode();document.getElementById('q-panel').classList.remove('hidden');
        loadCongestion();statsInterval=setInterval(loadCongestion,15000);
        requestNotificationPermission();startQueueListener();return}
    }}catch(e){}
}

// ═══ YOĞUNLUK ═══════════════════════════════════════
async function loadCongestion(){try{currentStats=await getMarketStats(marketId);renderCongestion(currentStats);updateWaitEstimate(currentStats)}catch(e){}}
function renderCongestion(s){
  var dot=document.getElementById('cg-dot'),lbl=document.getElementById('cg-lbl'),fill=document.getElementById('cg-fill'),info=document.getElementById('cg-info');
  if(!dot)return;var lv=s.congestionLevel;dot.className='cg-dot '+lv;fill.className='cg-fill '+lv;fill.style.width=s.congestionPercent+'%';
  if(lv==='sakin')lbl.textContent='🟢 Sakin';else if(lv==='normal')lbl.textContent='🟡 Normal';else lbl.textContent='🔴 Yoğun (%'+s.congestionPercent+')';
  info.textContent=[s.activeCasas+' kasa',s.waitingCount>0?s.waitingCount+' sırada':''].filter(Boolean).join(' · ');
}
function updateWaitEstimate(s){var el=document.getElementById('wait-est'),d=document.getElementById('wait-time');if(!el||!d)return;
  var qs=document.getElementById('screen-queued');if(!qs||!qs.classList.contains('active'))return;
  if(s&&s.estimatedWait>0){d.textContent=formatWaitTime(s.estimatedWait);el.style.display='flex'}
  else if(s&&s.waitingCount===0){d.textContent='Hemen';el.style.display='flex'}}

// ═══ KATEGORİ KARTLARI ═══════════════════════════════
function renderCategoryCards(){
  var sc=document.getElementById('cats-scroll');if(!sc)return;
  sc.innerHTML='';
  var cats=[
    {cls:'camp',icon:'🏷️',name:'Kampanyalar',sub:'Tüm aktif indirimler'},
    {cls:'surp',icon:'🎁',name:'Sürpriz İndirimler',sub:'Günlük fırsatlar'},
    {cls:'gun',icon:'⭐',name:'Günün Fırsatı',sub:'Kaçırmayın'}
  ];
  cats.forEach(function(c){
    var card=document.createElement('div');card.className='cat-card '+c.cls;
    card.innerHTML='<div class="cat-icon">'+c.icon+'</div><div class="cat-name">'+c.name+'</div><div class="cat-sub">'+c.sub+'</div>';
    sc.appendChild(card);
  });
}

// ═══ DUYURULAR ═══════════════════════════════════════
function loadAnnouncements(){
  db.collection('announcements').where('marketId','==',marketId).where('active','==',true).orderBy('order','asc')
    .onSnapshot(function(snap){announcements=snap.docs.map(function(d){return Object.assign({id:d.id},d.data())});renderAnnouncements()},
    function(err){db.collection('announcements').where('marketId','==',marketId)
      .onSnapshot(function(snap){announcements=snap.docs.map(function(d){return Object.assign({id:d.id},d.data())}).filter(function(a){return a.active===true}).sort(function(a,b){return(a.order||0)-(b.order||0)});renderAnnouncements()})});
}
function renderAnnouncements(){
  var section=document.getElementById('ann-section'),slider=document.getElementById('ann-slider'),dots=document.getElementById('ann-dots');
  if(!announcements.length){section.classList.add('empty');return}
  section.classList.remove('empty');slider.innerHTML='';dots.innerHTML='';
  announcements.forEach(function(a,i){
    var s=document.createElement('div');s.className='ann-slide'+(a.imageUrl?'':' no-img')+(i===0?' active':'');
    var t=document.createElement('div');t.className='ann-slide-text';
    var b=document.createElement('div');b.className='ann-slide-badge';b.textContent='🏷️ Kampanya';t.appendChild(b);
    var ti=document.createElement('div');ti.className='ann-slide-title';ti.textContent=a.title;t.appendChild(ti);
    if(a.content){var c=document.createElement('div');c.className='ann-slide-content';c.textContent=a.content;t.appendChild(c)}
    if(a.imageUrl){var img=document.createElement('img');img.className='ann-slide-img has-img';img.src=a.imageUrl;img.alt='';img.onerror=function(){this.style.display='none'};s.appendChild(img)}
    s.appendChild(t);slider.appendChild(s);
    var d=document.createElement('div');d.className='ann-dot'+(i===0?' active':'');dots.appendChild(d);
  });
  annIndex=0;clearInterval(announcementInterval);
  if(announcements.length>1)announcementInterval=setInterval(function(){annIndex=(annIndex+1)%announcements.length;
    document.querySelectorAll('.ann-slide').forEach(function(s,i){s.classList.toggle('active',i===annIndex)});
    document.querySelectorAll('.ann-dot').forEach(function(d,i){d.classList.toggle('active',i===annIndex)})},5000);
}

// ═══ SIRA İŞLEMLERİ ═════════════════════════════════
async function checkExistingQueue(){try{var doc=await db.collection('queue').doc(sessionId).get();
  if(doc.exists){var s=doc.data().status;if(['waiting','priority','priority_ready','called','arrived','active'].includes(s)){startQueueListener();return}}
  newSession();showScreen('ready')}catch(e){showScreen('ready')}}

function startQueueListener(){
  if(queueListener)queueListener();
  queueListener=db.collection('queue').doc(sessionId).onSnapshot(function(doc){
    if(!doc.exists){if(!isQueueMode)enterVitrinMode();else showScreen('ready');return}
    myQueueData=doc.data();var s=myQueueData.status;
    if(!isQueueMode&&s!=='done'&&s!=='cancelled'){enterQueueMode();document.getElementById('q-panel').classList.remove('hidden')}
    switch(s){
      case 'waiting':case 'priority':case 'priority_ready':showScreen('queued');if(currentStats)updateWaitEstimate(currentStats);break;
      case 'called':showScreen('called');document.getElementById('called-code').textContent=myQueueData.code||'---';
        document.getElementById('called-kasa').textContent='Kasa '+(myQueueData.kasaNo||'—');
        startCountdown(myQueueData.calledAt?.toDate()||new Date());
        if(!notifiedForThisCall){notifyCustomer(myQueueData.code,myQueueData.kasaNo);notifiedForThisCall=true}break;
      case 'arrived':clearInterval(countdownInterval);notifiedForThisCall=false;showScreen('arrived');break;
      case 'active':clearInterval(countdownInterval);notifiedForThisCall=false;showScreen('active');break;
      case 'timeout':clearInterval(countdownInterval);notifiedForThisCall=false;showScreen('timeout');break;
      case 'done':clearInterval(countdownInterval);notifiedForThisCall=false;
        document.getElementById('thanks-title').textContent='🛍️ Teşekkürler!';
        document.getElementById('thanks-sub').textContent=market?.thanksMessage||'Alışverişiniz için teşekkür ederiz. İyi günler!';
        showScreen('thanks');setTimeout(function(){newSession();enterVitrinMode();if(window.location.search)history.replaceState({},'',window.location.pathname)},5000);break;
      case 'cancelled':clearInterval(countdownInterval);notifiedForThisCall=false;newSession();enterVitrinMode();
        if(window.location.search)history.replaceState({},'',window.location.pathname);break;
      default:showScreen('ready');
    }
  });
}

function startCountdown(calledAt){clearInterval(countdownInterval);var total=120000;
  function tick(){var left=total-(Date.now()-calledAt.getTime());if(left<=0){document.getElementById('countdown').textContent='0:00';clearInterval(countdownInterval);return}
    var s=Math.ceil(left/1000);document.getElementById('countdown').textContent=Math.floor(s/60)+':'+(s%60).toString().padStart(2,'0')}
  tick();countdownInterval=setInterval(tick,500)}

async function handleQueueButton(){var btn=document.getElementById('btn-queue');btn.disabled=true;btn.textContent='Sıraya alınıyor...';
  try{var num=await getNextQueueNumber(marketId);
    await db.collection('queue').doc(sessionId).set({marketId:marketId,sessionId:sessionId,queueNumber:num,status:'waiting',code:null,registerId:null,kasaNo:null,createdAt:firebase.firestore.FieldValue.serverTimestamp(),calledAt:null,arrivedAt:null,completedAt:null});
    notifiedForThisCall=false;startQueueListener();await tryAssignToOpenRegister();await loadCongestion();
  }catch(e){btn.disabled=false;btn.textContent='KASA SIRASI AL';alert('Bir hata oluştu. Tekrar deneyin.')}}

async function tryAssignToOpenRegister(){try{var snap=await db.collection('registers').where('marketId','==',marketId).where('active','==',true).get();
  for(var i=0;i<snap.docs.length;i++){var d=snap.docs[i].data();if(!d.waitingQueueId){await assignNextToRegister(marketId,snap.docs[i].id,d.kasaNo);break}}}catch(e){}}

async function handleCancel(){if(!confirm('Sıranızı iptal etmek istiyor musunuz?'))return;
  try{await db.collection('queue').doc(sessionId).update({status:'cancelled'})}catch(e){}
  if(queueListener)queueListener();newSession();enterVitrinMode();if(window.location.search)history.replaceState({},'',window.location.pathname)}

async function handleErtele(){if(!myQueueData)return;var rid=myQueueData.registerId;
  await db.collection('queue').doc(sessionId).update({status:'priority',code:null,registerId:null,kasaNo:null,calledAt:null});
  if(rid){await db.collection('registers').doc(rid).update({waitingQueueId:null,waitingCode:null,calledAt:null});
    var rDoc=await db.collection('registers').doc(rid).get();if(rDoc.exists)await assignNextToRegister(marketId,rid,rDoc.data().kasaNo)}}

async function handleRetryQueue(){var btn=document.getElementById('btn-retry');btn.disabled=true;
  try{await db.collection('queue').doc(sessionId).update({status:'priority',calledAt:null,code:null,registerId:null,kasaNo:null});
    notifiedForThisCall=false;startQueueListener();await tryAssignToOpenRegister()}catch(e){btn.disabled=false}}

// ═══ QR TARAYICI ════════════════════════════════════
var qrStream=null,qrScanInterval=null;
function openQRScanner(){
  var ov=document.getElementById('qr-scanner'),vid=document.getElementById('qr-video'),st=document.getElementById('qr-status');
  ov.style.display='flex';st.textContent='Kamera açılıyor...';st.style.color='#94a3b8';
  navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:640},height:{ideal:640}}}).then(function(stream){
    qrStream=stream;vid.srcObject=stream;vid.play();st.textContent='Kamerayı QR koda doğrultun...';
    var cv=document.createElement('canvas'),ctx=cv.getContext('2d');
    qrScanInterval=setInterval(function(){if(vid.readyState<2)return;cv.width=vid.videoWidth;cv.height=vid.videoHeight;
      ctx.drawImage(vid,0,0);var data=ctx.getImageData(0,0,cv.width,cv.height);
      if(typeof jsQR!=='undefined'){var code=jsQR(data.data,cv.width,cv.height,{inversionAttempts:'dontInvert'});
        if(code&&code.data)processQRResult(code.data,st)}},200);
  }).catch(function(){st.textContent='Kamera açılamadı.';st.style.color='#f87171'});
}
function closeQRScanner(){if(qrScanInterval){clearInterval(qrScanInterval);qrScanInterval=null}
  if(qrStream){qrStream.getTracks().forEach(function(t){t.stop()});qrStream=null}
  var v=document.getElementById('qr-video');if(v)v.srcObject=null;document.getElementById('qr-scanner').style.display='none'}
function processQRResult(data,st){
  try{var url=new URL(data);var qm=url.searchParams.get('market');
    if(qm){st.textContent='✓ QR kod okundu!';st.style.color='#10e5b0';if(navigator.vibrate)navigator.vibrate(100);
      setTimeout(function(){closeQRScanner();marketId=qm;localStorage.setItem('mp_last_market',marketId);
        sessionId=localStorage.getItem('mp_s_'+marketId);if(!sessionId){sessionId=generateId();localStorage.setItem('mp_s_'+marketId,sessionId)}
        isQueueMode=true;history.replaceState({},'','?market='+marketId);loadMarket()},500);return}}catch(e){}
  st.textContent='Bu bir MarketPas QR kodu değil.';st.style.color='#fbbf24';
  setTimeout(function(){st.textContent='Kamerayı QR koda doğrultun...';st.style.color='#94a3b8'},2000);
}

// ═══ YARDIMCILAR ════════════════════════════════════
function showScreen(name){
  document.querySelectorAll('.scr').forEach(function(s){s.classList.remove('active')});
  var el=document.getElementById('screen-'+name);if(el)el.classList.add('active');
  if(name==='ready'){var b=document.getElementById('btn-queue');if(b){b.disabled=false;b.textContent='KASA SIRASI AL'}}
  if(name==='timeout'){var b2=document.getElementById('btn-retry');if(b2)b2.disabled=false}
  var we=document.getElementById('wait-est');if(we)we.style.display=(name==='queued'&&currentStats&&currentStats.estimatedWait>0)?'flex':'none';
  updateButtons();
}
function showLoading(v){var el=document.getElementById('loading');if(el)el.style.display=v?'flex':'none'}
function showError(msg){document.body.innerHTML='<div class="error-screen"><p>⚠️</p><p>'+escapeHtml(msg)+'</p></div>'}
function newSession(){sessionId=generateId();localStorage.setItem('mp_s_'+marketId,sessionId);if(queueListener){queueListener();queueListener=null}clearInterval(countdownInterval);notifiedForThisCall=false;myQueueData=null}

if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(function(){});
document.addEventListener('DOMContentLoaded',init);
