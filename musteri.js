// MarketPas v7 — Müşteri Ekranı (Lottie Enhanced)
var marketId=null,sessionId=null,market=null,queueListener=null,myQueueData=null;
var countdownInterval=null,announcementInterval=null,statsInterval=null;
var announcements=[],allAnnouncements=[],annIndex=0,notifiedForThisCall=false,currentStats=null;
var isQueueMode=false,sheetOpen=false;
var SPLASH_DURATION=5000;

// ═══ LOTTİE ANİMASYONLARI ═══
var LOTTIE={
  gift:'https://lottie.host/dea0ddec-e1a7-48c9-9fcc-3abbe7e12f5e/dPSYLvmYck.lottie',
  confetti:'https://assets2.lottiefiles.com/packages/lf20_aZTdD6.json',
  queued:'https://assets2.lottiefiles.com/packages/lf20_usmfx6bp.json',
  called:'https://assets2.lottiefiles.com/packages/lf20_puciaact.json',
  arrived:'https://assets10.lottiefiles.com/packages/lf20_jbrw3hcz.json',
  active:'https://assets10.lottiefiles.com/packages/lf20_svy4ivvy.json',
  thanks:'https://assets10.lottiefiles.com/packages/lf20_q5pk6p1k.json',
  timeout:'https://assets2.lottiefiles.com/packages/lf20_qpwbiyxf.json',
  empty_home:'https://assets2.lottiefiles.com/packages/lf20_xlmz9xwm.json',
  empty_campaign:'https://assets10.lottiefiles.com/packages/lf20_5ngs2ksb.json',
  empty_deal:'https://assets10.lottiefiles.com/packages/lf20_obhph3sh.json'
};

function createLottie(src,w,h,loop){
  var el=document.createElement('dotlottie-wc');
  el.setAttribute('src',src);
  if(loop!==false)el.setAttribute('loop','');
  el.setAttribute('autoplay','');
  el.style.width=(w||120)+'px';el.style.height=(h||120)+'px';
  el.style.display='block';
  return el;
}

function initLottieFor(containerId,src,w,h,loop){
  var c=document.getElementById(containerId);
  if(!c)return;c.innerHTML='';
  c.appendChild(createLottie(src,w||100,h||100,loop));
}

// Bildirim
async function requestNotificationPermission(){if(!('Notification' in window))return;if(Notification.permission==='default')await Notification.requestPermission()}
function notifyCustomer(code,kasaNo){
  if(navigator.vibrate)navigator.vibrate([300,100,300,100,500]);
  try{var ctx=new(window.AudioContext||window.webkitAudioContext)();var o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=880;g.gain.setValueAtTime(.3,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.5);o.start(ctx.currentTime);o.stop(ctx.currentTime+.5)}catch(e){}
  if(Notification.permission==='granted'&&document.hidden)new Notification('Sıranız Geldi!',{body:'Kodunuz: '+code+' — Kasa '+kasaNo+"'e gidiniz",icon:'/icon-192.png',tag:'mp-q',requireInteraction:true});
}

// ═══ BAŞLANGIÇ ═══
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
    applyBranding();loadAnnouncements();loadGiftData();
    // Market verisini canlı dinle
    db.collection('markets').doc(marketId).onSnapshot(function(snap){
      if(!snap.exists)return;
      market=snap.data();
    });
    if(isQueueMode){
      showSplash(function(){
        updateButtons();loadCongestion();checkExistingQueue();
        requestNotificationPermission();
        statsInterval=setInterval(loadCongestion,15000);
      });
    }else{
      updateButtons();checkExistingQueueSilent();
    }
  }catch(e){showError('Bağlantı hatası. Sayfayı yenileyin.')}
  finally{showLoading(false)}
}

function applyBranding(){
  document.getElementById('hdr-name').textContent=market.name;
  document.title=market.name;
  var icon=market.pwaIconUrl||market.logoUrl||'/icon-192.png';
  var name=market.name||'MarketPas';
  var f=document.getElementById('pwa-icon'),a=document.getElementById('pwa-apple-icon');
  if(f)f.href=icon;if(a)a.href=icon;
  var m={name:name,short_name:name.substring(0,12),start_url:'/musteri.html',display:'standalone',background_color:'#0a0f1a',theme_color:'#10e5b0',orientation:'portrait',icons:[{src:icon,sizes:'192x192',type:'image/png',purpose:'any maskable'},{src:icon,sizes:'512x512',type:'image/png',purpose:'any maskable'}]};
  var old=document.querySelector('link[rel="manifest"]');if(old)old.remove();
  var lnk=document.createElement('link');lnk.rel='manifest';lnk.href=URL.createObjectURL(new Blob([JSON.stringify(m)],{type:'application/json'}));document.head.appendChild(lnk);
}

// ═══ BUTON DURUMLARI ═══
function updateButtons(){
  var qrBtn=document.getElementById('btn-qr');
  var siraBtn=document.getElementById('btn-sira');
  if(!qrBtn||!siraBtn)return;
  var status=myQueueData?myQueueData.status:null;
  var inQueue=status&&['waiting','priority','priority_ready','called','arrived','active','paused'].indexOf(status)>-1;
  qrBtn.disabled=isQueueMode;
  qrBtn.classList.toggle('passive',isQueueMode);
  siraBtn.disabled=!(isQueueMode&&!inQueue);
}

// ═══ BOTTOM SHEET ═══
function openSheet(){
  var sheet=document.getElementById('sheet');
  var overlay=document.getElementById('sheet-overlay');
  sheet.classList.add('open');overlay.style.display='block';
  setTimeout(function(){overlay.classList.add('show')},10);
  sheetOpen=true;
  if(!statsInterval){loadCongestion();statsInterval=setInterval(loadCongestion,15000)}
  checkExistingQueue();requestNotificationPermission();
}

function closeSheet(){
  var sheet=document.getElementById('sheet');
  var overlay=document.getElementById('sheet-overlay');
  sheet.classList.remove('open');overlay.classList.remove('show');
  setTimeout(function(){overlay.style.display='none'},300);
  sheetOpen=false;
}

function toggleSheet(){
  if(sheetOpen)closeSheetIfAllowed();else openSheet();
}

function closeSheetIfAllowed(){
  var status=myQueueData?myQueueData.status:null;
  var locked=status&&['waiting','priority','priority_ready','called','arrived','active','paused'].indexOf(status)>-1;
  if(!locked)closeSheet();
}

// ═══ SPLASH ═══
function showSplash(cb){
  var key='mp_w_'+marketId;var last=localStorage.getItem(key);
  if(last&&(Date.now()-parseInt(last))<600000){if(cb)cb();return}
  var el=document.getElementById('splash'),bg=document.getElementById('splash-bg');
  var nameEl=document.getElementById('splash-name'),fill=document.getElementById('splash-fill');
  nameEl.textContent=market.name;
  if(market.welcomeImageUrl){bg.style.backgroundImage='url('+market.welcomeImageUrl+')';bg.style.backgroundSize='cover';bg.style.backgroundPosition='center'}
  el.style.display='flex';localStorage.setItem(key,Date.now().toString());
  var t=0,iv=setInterval(function(){t+=100;fill.style.width=Math.min(100,t/SPLASH_DURATION*100)+'%';
    if(t>=SPLASH_DURATION){clearInterval(iv);closeSplash(el,cb)}},100);
  el.onclick=function(){clearInterval(iv);closeSplash(el,cb)};
}
function closeSplash(el,cb){el.style.opacity='0';el.style.transition='opacity .4s';setTimeout(function(){el.style.display='none';el.style.opacity='1';el.style.transition='';el.onclick=null;if(cb)cb()},400)}

// ═══ MOD GEÇİŞLERİ ═══
function enterQueueMode(){isQueueMode=true;openSheet();updateButtons()}
function enterVitrinMode(){
  isQueueMode=false;closeSheet();updateButtons();
}

async function checkExistingQueueSilent(){
  try{var doc=await db.collection('queue').doc(sessionId).get();
    if(doc.exists){var s=doc.data().status;
      if(['waiting','priority','priority_ready','called','arrived','active','paused'].includes(s)){
        isQueueMode=true;updateButtons();openSheet();
        loadCongestion();statsInterval=setInterval(loadCongestion,15000);
        requestNotificationPermission();startQueueListener();return}
    }}catch(e){}
}

// ═══ YOĞUNLUK ═══
async function loadCongestion(){try{currentStats=await getMarketStats(marketId);renderCongestion(currentStats);updateWaitEstimate(currentStats)}catch(e){}}
function renderCongestion(s){
  var dot=document.getElementById('cg-dot'),lbl=document.getElementById('cg-lbl'),fill=document.getElementById('cg-fill'),info=document.getElementById('cg-info');
  if(!dot)return;var lv=s.congestionLevel;dot.className='cg-dot '+lv;fill.className='cg-fill '+lv;fill.style.width=s.congestionPercent+'%';
  if(lv==='sakin')lbl.textContent='🟢 Sakin';else if(lv==='normal')lbl.textContent='🟡 Normal';else lbl.textContent='🔴 Yoğun';
  var parts=[];
  if(s.activeCasas>0)parts.push(s.activeCasas+' kasa açık');
  if(s.waitingCount>0)parts.push(s.waitingCount+' kişi sırada');
  if(s.estimatedWait>0)parts.push('~'+formatWaitTime(s.estimatedWait)+' bekleme');
  else if(s.activeCasas>0&&s.waitingCount===0)parts.push('Sıra yok — hemen');
  info.textContent=parts.join(' · ');
}
function updateWaitEstimate(s){var el=document.getElementById('wait-est'),d=document.getElementById('wait-time');if(!el||!d)return;
  var qs=document.getElementById('screen-queued');if(!qs||!qs.classList.contains('active'))return;
  if(!s||s.activeCasas===0){el.style.display='none';return}
  
  // Kişisel tahmini hesapla — müşterinin sıra pozisyonuna göre
  if(myQueueData&&s.avgProcessTime>0){
    var myPos=s.waitingCount; // En kötü ihtimal — sıranın sonunda
    // Eğer queueNumber varsa daha hassas hesapla
    if(myQueueData.queueNumber){
      // Kendinden önce kaç kişi var sayalım (basitleştirilmiş)
      myPos=Math.max(1,s.waitingCount);
    }
    var myWait=Math.ceil(myPos/s.activeCasas)*s.avgProcessTime;
    if(myWait>0){
      d.textContent=formatWaitTime(myWait);
      el.style.display='flex';
    }else{
      d.textContent='Hemen';el.style.display='flex';
    }
  }else if(s.waitingCount===0){
    d.textContent='Hemen';el.style.display='flex';
  }else{el.style.display='none'}
}

// ═══ DUYURULAR ═══
function loadAnnouncements(){
  db.collection('announcements').where('marketId','==',marketId).where('active','==',true).orderBy('order','asc')
    .onSnapshot(function(snap){allAnnouncements=snap.docs.map(function(d){return Object.assign({id:d.id},d.data())});announcements=allAnnouncements.filter(function(a){return(a.category||'kampanya')==='anasayfa'});renderAnnouncements()},
    function(){db.collection('announcements').where('marketId','==',marketId)
      .onSnapshot(function(snap){allAnnouncements=snap.docs.map(function(d){return Object.assign({id:d.id},d.data())}).filter(function(a){return a.active===true}).sort(function(a,b){return(a.order||0)-(b.order||0)});announcements=allAnnouncements.filter(function(a){return(a.category||'kampanya')==='anasayfa'});renderAnnouncements()})});
}
function filterCat(cat){
  document.querySelectorAll('.tab-item').forEach(function(t){t.classList.remove('active')});
  event.currentTarget.classList.add('active');
  console.log('MarketPas: Tab değişti →', cat, '| giftData:', giftData ? 'var' : 'yok');
  // Hediye gösterimi — Sürpriz sekmesinde her zaman göster
  if(cat==='gunun_firsati'){pickActiveGift();showGiftScreen()}
  else{hideGiftScreen()}
  announcements=allAnnouncements.filter(function(a){return(a.category||'kampanya')===cat});
  renderAnnouncements();
}
function renderAnnouncements(){
  var section=document.getElementById('ann-section'),slider=document.getElementById('ann-slider'),dots=document.getElementById('ann-dots');
  
  if(!announcements.length){
    section.classList.remove('empty');
    dots.innerHTML='';
    // Kategori bazlı boş ekran
    var activeTab='anasayfa';
    var activeEl=document.querySelector('.tab-item.active');
    if(activeEl){var oc=activeEl.getAttribute('onclick');if(oc){var m=oc.match(/filterCat\('([^']+)'\)/);if(m)activeTab=m[1]}}
    
    var placeholders={
      anasayfa:{lottie:LOTTIE.empty_home,title:'HOŞ GELDİNİZ',sub:'Duyurularımızı buradan takip edebilirsiniz',color:'#60a5fa'},
      kampanya:{lottie:LOTTIE.empty_campaign,title:'KAMPANYALAR YAKINDA',sub:'İndirim ve kampanyalarımızı kaçırmayın',color:'#4ade80'},
      surpriz:{lottie:LOTTIE.empty_deal,title:'FIRSATLARI TAKİP EDİN',sub:'Sürpriz fırsat indirimleri burada olacak',color:'#fbbf24'},
      gunun_firsati:null
    };
    var ph=placeholders[activeTab];
    if(!ph){slider.innerHTML='';return}
    
    var wrap=document.createElement('div');wrap.className='empty-state';
    var particles=document.createElement('div');particles.className='empty-particles';
    for(var p=0;p<6;p++){particles.appendChild(document.createElement('span'))}
    wrap.appendChild(particles);
    var card=document.createElement('div');card.className='empty-card';card.style.borderColor=ph.color;
    var lottieDiv=document.createElement('div');lottieDiv.className='empty-lottie';
    lottieDiv.appendChild(createLottie(ph.lottie,120,120,true));
    card.appendChild(lottieDiv);
    var title=document.createElement('div');title.className='empty-title';title.style.color=ph.color;title.textContent=ph.title;card.appendChild(title);
    var sub=document.createElement('div');sub.className='empty-sub';sub.textContent=ph.sub;card.appendChild(sub);
    wrap.appendChild(card);
    slider.innerHTML='';slider.appendChild(wrap);
    return;
  }
  
  section.classList.remove('empty');slider.innerHTML='';dots.innerHTML='';
  announcements.forEach(function(a,i){
    var hasVideo=a.videoUrl&&getYouTubeId(a.videoUrl);
    var hasImg=a.imageUrl&&!hasVideo;
    var s=document.createElement('div');s.className='ann-slide'+(hasImg||hasVideo?'':' no-img')+(i===0?' active':'');
    if(hasVideo)s.classList.add('video-slide');

    // Video slide
    if(hasVideo){
      var vid=getYouTubeId(a.videoUrl);
      var iframe=document.createElement('iframe');
      iframe.className='ann-slide-video';
      iframe.src='https://www.youtube.com/embed/'+vid+'?autoplay='+(i===0?'1':'0')+'&mute=1&loop=1&playlist='+vid+'&controls=0&showinfo=0&rel=0&modestbranding=1&playsinline=1&disablekb=1&fs=0&iv_load_policy=3';
      iframe.setAttribute('frameborder','0');
      iframe.setAttribute('allow','autoplay;encrypted-media');
      iframe.setAttribute('allowfullscreen','');
      s.appendChild(iframe);
    }
    // Görsel slide
    else if(hasImg){
      var img=document.createElement('img');img.className='ann-slide-img has-img';img.src=a.imageUrl;img.alt='';img.onerror=function(){this.style.display='none'};s.appendChild(img);
    }

    // Metin katmanı
    var t=document.createElement('div');t.className='ann-slide-text';
    var catNames={anasayfa:'DUYURU',kampanya:'KAMPANYA',gunun_firsati:'SÜRPRİZ',surpriz:'FIRSAT'};
    var catIcons={anasayfa:'📢',kampanya:'🏷️',gunun_firsati:'🎁',surpriz:'⭐'};
    var b=document.createElement('div');b.className='ann-slide-badge';b.textContent=(catIcons[a.category]||'🏷️')+' '+(catNames[a.category]||'KAMPANYA');t.appendChild(b);
    var ti=document.createElement('div');ti.className='ann-slide-title';ti.textContent=a.title;t.appendChild(ti);
    if(a.content&&!hasVideo){var c=document.createElement('div');c.className='ann-slide-content';c.textContent=a.content;t.appendChild(c)}
    if(!hasVideo)s.appendChild(t);

    slider.appendChild(s);
    var d=document.createElement('div');d.className='ann-dot'+(i===0?' active':'');dots.appendChild(d);
  });
  annIndex=0;clearInterval(announcementInterval);
  if(announcements.length>1)announcementInterval=setInterval(function(){
    var prevIdx=annIndex;
    annIndex=(annIndex+1)%announcements.length;
    // Video iframe autoplay yönetimi
    var slides=document.querySelectorAll('.ann-slide');
    slides.forEach(function(s,i){
      s.classList.toggle('active',i===annIndex);
      var iframe=s.querySelector('iframe');
      if(iframe){
        var src=iframe.src;
        if(i===annIndex)iframe.src=src.replace('autoplay=0','autoplay=1');
        else iframe.src=src.replace('autoplay=1','autoplay=0');
      }
    });
    document.querySelectorAll('.ann-dot').forEach(function(d,i){d.classList.toggle('active',i===annIndex)});
  },7000);
}

function getYouTubeId(url){
  if(!url)return null;
  var m=url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^?&]+)/);
  return m?m[1]:null;
}

// ═══ SIRA İŞLEMLERİ ═══
async function checkExistingQueue(){try{var doc=await db.collection('queue').doc(sessionId).get();
  if(doc.exists){var s=doc.data().status;if(['waiting','priority','priority_ready','called','arrived','active','paused'].includes(s)){startQueueListener();return}}
  newSession();showScreen('ready')}catch(e){showScreen('ready')}}

function startQueueListener(){
  if(queueListener)queueListener();
  queueListener=db.collection('queue').doc(sessionId).onSnapshot(function(doc){
    if(!doc.exists){if(!isQueueMode)enterVitrinMode();else showScreen('ready');return}
    myQueueData=doc.data();var s=myQueueData.status;
    if(!sheetOpen&&s!=='done'&&s!=='cancelled'){enterQueueMode()}
    switch(s){
      case 'waiting':case 'priority':case 'priority_ready':showScreen('queued');if(currentStats)updateWaitEstimate(currentStats);break;
      case 'called':showScreen('called');document.getElementById('called-code').textContent=myQueueData.code||'---';
        document.getElementById('called-kasa').textContent='KASA '+(myQueueData.kasaNo||'—');
        startCountdown(myQueueData.calledAt?.toDate()||new Date());
        if(!notifiedForThisCall){notifyCustomer(myQueueData.code,myQueueData.kasaNo);notifiedForThisCall=true}break;
      case 'arrived':clearInterval(countdownInterval);notifiedForThisCall=false;showScreen('arrived');break;
      case 'active':clearInterval(countdownInterval);notifiedForThisCall=false;showScreen('active');break;
      case 'paused':clearInterval(countdownInterval);notifiedForThisCall=false;showScreen('paused');break;
      case 'timeout':clearInterval(countdownInterval);notifiedForThisCall=false;showScreen('timeout');break;
      case 'done':clearInterval(countdownInterval);notifiedForThisCall=false;
        document.getElementById('thanks-title').textContent='Kasa İşleminiz Tamamlandı';
        document.getElementById('thanks-sub').textContent='Teşekkür ederiz. İyi günler dileriz!';
        showScreen('thanks');setTimeout(function(){newSession();enterVitrinMode();if(window.location.search)history.replaceState({},'',window.location.pathname)},6000);break;
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
    console.log('MarketPas: Sıra no:',num);
    await db.collection('queue').doc(sessionId).set({marketId:marketId,sessionId:sessionId,queueNumber:num,status:'waiting',code:null,registerId:null,kasaNo:null,createdAt:firebase.firestore.FieldValue.serverTimestamp(),calledAt:null,arrivedAt:null,completedAt:null});
    notifiedForThisCall=false;startQueueListener();await tryAssignToOpenRegister();await loadCongestion();
  }catch(e){console.error('MarketPas:',e);btn.disabled=false;btn.textContent='KASA SIRASI AL';alert('Hata: '+e.message)}}

async function tryAssignToOpenRegister(){try{
    var snap=await db.collection('registers').where('marketId','==',marketId).where('active','==',true).get();
    for(var i=0;i<snap.docs.length;i++){var d=snap.docs[i].data();
      if(d.waitingQueueId){try{var stuckDoc=await db.collection('queue').doc(d.waitingQueueId).get();
        if(!stuckDoc.exists||['done','cancelled','timeout'].indexOf(stuckDoc.data().status)>-1){
          await db.collection('registers').doc(snap.docs[i].id).update({waitingQueueId:null,waitingCode:null,calledAt:null});d.waitingQueueId=null}}catch(e){}}
      if(!d.waitingQueueId){await assignNextToRegister(marketId,snap.docs[i].id,d.kasaNo);break}}
  }catch(e){}}

async function handleCancel(){showConfirmModal('Sıranızı iptal etmek istiyor musunuz?',async function(){
  try{await db.collection('queue').doc(sessionId).update({status:'cancelled'})}catch(e){}
  if(queueListener)queueListener();newSession();enterVitrinMode();if(window.location.search)history.replaceState({},'',window.location.pathname)})}

async function handleErtele(){if(!myQueueData)return;var rid=myQueueData.registerId;
  await db.collection('queue').doc(sessionId).update({status:'paused',code:null,registerId:null,kasaNo:null,calledAt:null});
  if(rid){await db.collection('registers').doc(rid).update({waitingQueueId:null,waitingCode:null,calledAt:null})}
  clearInterval(countdownInterval);notifiedForThisCall=false;}

async function handleReady(){
  try{await db.collection('queue').doc(sessionId).update({status:'priority_ready',calledAt:null,code:null,registerId:null,kasaNo:null});
    notifiedForThisCall=false;startQueueListener();await tryAssignToOpenRegister()}catch(e){}}

async function handleRetryQueue(){var btn=document.getElementById('btn-retry');btn.disabled=true;
  try{await db.collection('queue').doc(sessionId).update({status:'priority_ready',calledAt:null,code:null,registerId:null,kasaNo:null});
    notifiedForThisCall=false;startQueueListener();await tryAssignToOpenRegister()}catch(e){btn.disabled=false}}

// ═══ QR ═══
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

// ═══ YARDIMCILAR ═══
function showScreen(name){
  document.querySelectorAll('.scr').forEach(function(s){s.classList.remove('active')});
  var el=document.getElementById('screen-'+name);if(el)el.classList.add('active');
  if(name==='ready'){var b=document.getElementById('btn-queue');if(b){b.disabled=false;b.textContent='KASA SIRASI AL'}}
  if(name==='timeout'){var b2=document.getElementById('btn-retry');if(b2)b2.disabled=false}
  var we=document.getElementById('wait-est');if(we)we.style.display=(name==='queued'&&currentStats&&currentStats.estimatedWait>0)?'flex':'none';
  // Lottie animasyonları
  var lottieMap={queued:'queued',called:'called',arrived:'arrived',active:'active',thanks:'thanks',timeout:'timeout'};
  if(lottieMap[name]&&LOTTIE[lottieMap[name]]){
    initLottieFor('lottie-'+name,LOTTIE[lottieMap[name]],90,90,name!=='thanks');
  }
  updateButtons();
}
function showLoading(v){var el=document.getElementById('loading');if(el)el.style.display=v?'flex':'none'}
function showError(msg){document.body.innerHTML='<div class="error-screen"><p>⚠️</p><p>'+escapeHtml(msg)+'</p></div>'}
function newSession(){sessionId=generateId();localStorage.setItem('mp_s_'+marketId,sessionId);if(queueListener){queueListener();queueListener=null}clearInterval(countdownInterval);notifiedForThisCall=false;myQueueData=null}

function showConfirmModal(msg,onConfirm){
  var m=document.getElementById('confirm-modal');
  document.getElementById('modal-msg').textContent=msg;
  m.style.display='flex';
  document.getElementById('modal-cancel').onclick=function(){m.style.display='none'};
  document.getElementById('modal-confirm').onclick=function(){m.style.display='none';if(onConfirm)onConfirm()};
}

if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(function(){});

// ═══ SÜRPRİZ HEDİYE KUTUSU ═══
var giftData=null,giftInterval=null,giftRevealed=false;
var allGifts=[];

function loadGiftData(){
  db.collection('gifts').where('marketId','==',marketId)
    .onSnapshot(function(snap){
      allGifts=snap.docs.map(function(d){return Object.assign({id:d.id},d.data())});
      pickActiveGift();
    },function(){
      // Index yoksa basit sorgu
      db.collection('gifts').where('marketId','==',marketId).get().then(function(snap){
        allGifts=snap.docs.map(function(d){return Object.assign({id:d.id},d.data())});
        pickActiveGift();
      });
    });
}

function pickActiveGift(){
  var now=new Date();
  giftData=null;giftRevealed=false;
  // Önce aktif (açılmış, süresi devam eden) sürprizi bul
  for(var i=0;i<allGifts.length;i++){
    var g=allGifts[i];
    if(g.status==='stopped')continue;
    var reveal=g.revealAt?.toDate?g.revealAt.toDate():new Date(g.revealAt);
    var end=g.endAt?.toDate?g.endAt.toDate():new Date(g.endAt);
    if(now>=reveal&&now<end){
      giftData={title:g.title,content:g.content,imageUrl:g.imageUrl,_revealDate:reveal,_endDate:end};
      console.log('MarketPas Gift: Aktif sürpriz bulundu —',g.title);return;
    }
  }
  // Yoksa en yakın bekleyen sürprizi bul
  var closest=null,closestReveal=null;
  for(var j=0;j<allGifts.length;j++){
    var g2=allGifts[j];
    if(g2.status==='stopped')continue;
    var r2=g2.revealAt?.toDate?g2.revealAt.toDate():new Date(g2.revealAt);
    var e2=g2.endAt?.toDate?g2.endAt.toDate():new Date(g2.endAt);
    if(now<r2&&now<e2){
      if(!closestReveal||r2<closestReveal){closest=g2;closestReveal=r2}
    }
  }
  if(closest){
    var cr=closest.revealAt?.toDate?closest.revealAt.toDate():new Date(closest.revealAt);
    var ce=closest.endAt?.toDate?closest.endAt.toDate():new Date(closest.endAt);
    giftData={title:closest.title,content:closest.content,imageUrl:closest.imageUrl,_revealDate:cr,_endDate:ce};
    console.log('MarketPas Gift: Bekleyen sürpriz —',closest.title,'açılma:',cr);
  }else{
    console.log('MarketPas Gift: Aktif/bekleyen sürpriz yok');
    giftData=null;
  }
}

function showGiftScreen(){
  var gs=document.getElementById('gift-screen');
  if(!gs)return;
  gs.style.display='flex';
  document.getElementById('ann-slider').style.display='none';
  document.getElementById('ann-dots').style.display='none';

  if(!giftData){showGiftExpired();return}

  var now=new Date();
  if(now>=giftData._endDate){
    showGiftExpired();
  }else if(now>=giftData._revealDate||giftRevealed){
    revealGift();
    startEndCountdown();
  }else{
    document.getElementById('gift-pre').style.display='flex';
    document.getElementById('gift-reveal').style.display='none';
    document.getElementById('gift-expired').style.display='none';
    // Lottie hediye kutusu
    initLottieFor('lottie-gift',LOTTIE.gift,200,200,true);
    startGiftCountdown();
  }
}

function hideGiftScreen(){
  var gs=document.getElementById('gift-screen');
  if(gs)gs.style.display='none';
  document.getElementById('ann-slider').style.display='';
  document.getElementById('ann-dots').style.display='';
  if(giftInterval){clearInterval(giftInterval);giftInterval=null}
}

function startGiftCountdown(){
  if(giftInterval)clearInterval(giftInterval);
  function tick(){
    var now=new Date();
    var diff=giftData._revealDate.getTime()-now.getTime();
    if(diff<=0){clearInterval(giftInterval);giftInterval=null;triggerRevealAnimation();return}
    var h=Math.floor(diff/3600000);
    var m=Math.floor((diff%3600000)/60000);
    var s=Math.floor((diff%60000)/1000);
    document.getElementById('gcd-h').textContent=h.toString().padStart(2,'0');
    document.getElementById('gcd-m').textContent=m.toString().padStart(2,'0');
    document.getElementById('gcd-s').textContent=s.toString().padStart(2,'0');
    // Son 60 saniye — heyecan modu
    var box=document.getElementById('gift-box');
    if(box){
      if(diff<60000)box.className='gift-box-3d excited';
      else box.className='gift-box-3d';
    }
  }
  tick();giftInterval=setInterval(tick,1000);
}

function triggerRevealAnimation(){
  var box=document.getElementById('gift-box');
  if(box){box.className='gift-box-3d opening'}
  setTimeout(function(){revealGift();startEndCountdown()},1000);
}

function revealGift(){
  giftRevealed=true;
  document.getElementById('gift-pre').style.display='none';
  var rv=document.getElementById('gift-reveal');rv.style.display='block';
  document.getElementById('reveal-title').textContent=giftData.title||'Sürpriz!';
  document.getElementById('reveal-content').textContent=giftData.content||'';
  var img=document.getElementById('reveal-img');
  if(giftData.imageUrl){img.src=giftData.imageUrl;img.style.display='block';img.onerror=function(){this.style.display='none'}}
  spawnSceneConfetti();
}

function spawnSceneConfetti(){
  var c=document.getElementById('scene-confetti');if(!c)return;c.innerHTML='';
  var colors=['#fbbf24','#ef4444','#10b981','#a78bfa','#f472b6','#60a5fa','#34d399','#f97316','#06b6d4','#e879f9'];
  for(var i=0;i<60;i++){
    var p=document.createElement('div');p.className='cf';
    // Rastgele yön — kutudan her yöne fışkırır
    var angle=(Math.random()*360)*(Math.PI/180);
    var dist=150+Math.random()*300;
    var tx=Math.cos(angle)*dist;
    var ty=-Math.abs(Math.sin(angle)*dist)-(Math.random()*200); // yukarı ağırlıklı
    var endY=ty+400+Math.random()*300; // yerçekimi ile düşüş
    p.style.background=colors[Math.floor(Math.random()*colors.length)];
    p.style.width=(5+Math.random()*7)+'px';
    p.style.height=(6+Math.random()*9)+'px';
    p.style.borderRadius=Math.random()>.5?'50%':'2px';
    p.style.animationDelay=(Math.random()*.3)+'s';
    p.style.animation='cfShoot'+i+' '+(2+Math.random()*1.5)+'s ease-out forwards';
    // Her parça için unique keyframe
    var style=document.createElement('style');
    style.textContent='@keyframes cfShoot'+i+'{0%{transform:translate(-50%,0) rotate(0);opacity:1}20%{transform:translate('+tx*0.6+'px,'+ty+'px) rotate('+(360+Math.random()*360)+'deg);opacity:1}100%{transform:translate('+tx+'px,'+endY+'px) rotate('+(720+Math.random()*720)+'deg);opacity:0}}';
    document.head.appendChild(style);
    c.appendChild(p);
  }
}

var giftEndInterval=null;
function startEndCountdown(){
  if(giftEndInterval)clearInterval(giftEndInterval);
  var timerEl=document.getElementById('reveal-end-timer');
  var timeEl=document.getElementById('reveal-end-time');
  if(!timerEl||!timeEl||!giftData._endDate)return;
  timerEl.style.display='block';
  function tick(){
    var left=giftData._endDate.getTime()-Date.now();
    if(left<=0){clearInterval(giftEndInterval);giftEndInterval=null;showGiftExpired();return}
    var m=Math.floor(left/60000);
    var s=Math.floor((left%60000)/1000);
    timeEl.textContent=m+':'+s.toString().padStart(2,'0');
  }
  tick();giftEndInterval=setInterval(tick,1000);
}

function showGiftExpired(){
  if(giftEndInterval){clearInterval(giftEndInterval);giftEndInterval=null}
  document.getElementById('gift-pre').style.display='none';
  document.getElementById('gift-reveal').style.display='none';
  document.getElementById('gift-expired').style.display='flex';
}

document.addEventListener('DOMContentLoaded',init);
